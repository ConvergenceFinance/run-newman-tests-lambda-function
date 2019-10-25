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

const httpRequest = (url) => {
    return new Promise(
        (resolve, reject) => {
            const request = https.get(url, function (response) {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(`An error occurred while fetching the file: ${url}`)
                } else {
                    resolve(response)
                }
            }).on("error", function (error) {
                reject(error);
            });
        }
    )
}

exports.handler = async (event, context) => {
    const tmpBuildArtifactPath = "/tmp/BuildArtifact.zip";
    const jobMeta = event["CodePipeline.job"]
    const jobId = jobMeta.id

    const result = new Promise(
        async (resolve, reject) => {
            let newmanFiles = {
                testFile: null,
                environmentFile: null
            }
            let inputArtifactsMeta = jobMeta["data"]["inputArtifacts"]

            if (inputArtifactsMeta.length < 1) {
                reject("Skipping. No input artifacts found.")
                return false
            }

            let url = null
            for (let inputArtifactMeta of inputArtifactsMeta) {
                if (inputArtifactMeta.name === "BuildArtifact") {
                    url = await getArtifactURL(inputArtifactMeta.location.s3Location.bucketName, inputArtifactMeta.location.s3Location.objectKey)
                    break;
                }
            }

            if (url === null) {
                reject("Unable to find the BuildArtifact. Are you sure a valid payload was passed?")
                return false
            }

            const file = fs.createWriteStream(tmpBuildArtifactPath);
            const request = await httpRequest(url).then((response) => {
                response.pipe(file)
                file.on('finish', () => {
                    file.close()
                });
                return true;
            }).catch(error => {
                fs.unlink(tmpBuildArtifactPath);
                return error;
            })

            if (request !== true) {
                reject(request)
                return false;
            }

            try {
                newmanFiles = await decompress(tmpBuildArtifactPath, '/tmp/dist').then(
                    (files) => {
                        const fileData = {
                            environmentFile: null,
                            testFile: null
                         }

                        for (let file of files) {
                            if (file.path == "newman.development.env.json") {
                                fileData.environmentFile = file.data.toString('utf8');
                            }
                            if (file.path == "newman.tests.json") {
                                fileData.testFile = file.data.toString('utf8');
                            }
                        }

                        return fileData;
                    }
                );
            } catch(error) {
                reject(error)
                return false
            }

            if (newmanFiles.environmentFile !== null && newmanFiles.testFile !== null) {
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
                return false;
            }

            return true;
        }
    );

    return result.then(
        async (success) => {
            await CodePipeline.putJobSuccessResult({ jobId, executionDetails: { summary: success.toString(), percentComplete: 100, externalExecutionId: context.awsRequestId } }).promise()
            return success
        }
    ).catch(
        async (error) => {
            console.error(error);
            await CodePipeline.putJobFailureResult({ jobId, failureDetails: { type: "JobFailed", message: error.toString(), externalExecutionId: context.awsRequestId } }).promise()
            return error
        }
    )
}