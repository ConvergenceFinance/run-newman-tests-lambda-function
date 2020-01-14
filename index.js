const AWS = require("aws-sdk")
const newman = require("newman")
const decompress = require("decompress")
const s3 = new AWS.S3()
const fs = require("fs")
const https = require("https")
const CodePipeline = new AWS.CodePipeline()

const getArtifactURL = async (Bucket, Key) => {
    try {
        return await s3.getSignedUrlPromise("getObject", { Bucket, Key })
    } catch (error) {
        console.log("Failed to retrieve from S3: " + bucket + key)
        throw error
    }
}

const download = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest, { flags: "wx" });

        const request = https.get(url, response => {
            if (response.statusCode === 200) {
                response.pipe(file);
            } else {
                file.close();
                fs.unlink(dest, () => { }); // Delete temp file
                reject(`Server responded with ${response.statusCode}: ${response.statusMessage}`);
            }
        });

        request.on("error", err => {
            file.close();
            fs.unlink(dest, () => { }); // Delete temp file
            reject(err.message);
        });

        file.on("finish", () => {
            resolve();
        });

        file.on("error", err => {
            file.close();

            if (err.code === "EEXIST") {
                reject("File already exists");
            } else {
                fs.unlink(dest, () => { }); // Delete temp file
                reject(err.message);
            }
        });
    });
}

exports.handler = async (event, context) => {
    console.debug("[newman Lambda] Loaded index.handler")

    const tmpBuildArtifactPath = "/tmp/BuildArtifact.zip"
    const jobMeta = event["CodePipeline.job"]
    const jobId = jobMeta.id

    const result = new Promise(
        async (resolve, reject) => {
            let newmanFiles = {
                testFile: null,
                environmentFile: null
            }
            let inputArtifactsMeta = jobMeta["data"]["inputArtifacts"]

            console.debug("[newman Lambda] Checking for input artifacts")
            if (inputArtifactsMeta.length < 1) {
                reject("Skipping. No input artifacts found.")
                return false
            }

            console.debug("[newman Lambda] Checking for a valid build artifact")
            let url = null
            for (let inputArtifactMeta of inputArtifactsMeta) {
                if (inputArtifactMeta.name === "BuildArtifact") {
                    url = await getArtifactURL(inputArtifactMeta.location.s3Location.bucketName, inputArtifactMeta.location.s3Location.objectKey)
                    break
                }
            }

            if (url === null) {
                reject("Unable to find the BuildArtifact. Are you sure a valid payload was passed?")
                return false
            }

            console.debug(`[newman Lambda] Obtained the build artifact from AWS: ${url}`)

            console.debug("[newman Lambda] Opening the build artifact (zip)")
            try {
                console.debug(`[newman Lambda] Write to temp file: ${tmpBuildArtifactPath}`)
                const request = await download(url, tmpBuildArtifactPath)
            } catch(error) {
                reject(error)
                return false
            }

            console.debug("[newman Lambda] Decompressing the zip")
            try {
                await decompress(tmpBuildArtifactPath, '/tmp/dist')
                .then(
                    (files) => {
                        for (let file of files) {
                            if (file.path === "newman.development.env.json") {
                                newmanFiles.environmentFile = file.data.toString('utf8')
                            }
                            if (file.path === "newman.tests.json") {
                                newmanFiles.testFile = file.data.toString('utf8')
                            }
                        }
                    }
                )
            } catch(error) {
                reject(error)
                return false
            }

            console.debug("[newman Lambda] Checking to make sure we have our newman files")
            if (newmanFiles.environmentFile !== null && newmanFiles.testFile !== null) {
                console.debug("[newman Lambda] Running newman tests (parsing files directly from disk/memory)")
                newman.run({
                    collection: JSON.parse(newmanFiles.testFile),
                    environment: JSON.parse(newmanFiles.environmentFile),
                    reporters: "cli"
                }).on("start", function (err, args) { // on start of run, log to console
                    console.log("Started running newman on the collection.")
                }).on("done", function (err, summary) {
                    if (err || summary.error) {
                        reject("There was an error running newman.")
                    } else {
                        if (summary.run.failures.length > 0) {
                            reject("Newman encountered failures.")
                        } else {
                            resolve("Newman successfully completed all tests.")
                        }
                    }
                })
            } else {
                reject(`Newman URLs were not set. Missing artifacts?`)
                return false
            }

            return true
        }
    )

    return result.then(
        async (success) => {
            await CodePipeline.putJobSuccessResult({ jobId, executionDetails: { summary: success.toString(), percentComplete: 100, externalExecutionId: context.awsRequestId } }).promise()
            return success
        }
    ).catch(
        async (error) => {
            console.error(error)
            await CodePipeline.putJobFailureResult({ jobId, failureDetails: { type: "JobFailed", message: error.toString(), externalExecutionId: context.awsRequestId } }).promise()
            return error
        }
    )
}