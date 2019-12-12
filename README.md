# Run Newman Tests (Lambda Function)
A Lambda function intended to be used with AWS CodeDeploy to run newman tests as part of a CI/CD process.

## Installation
1. Create a CodeDeploy Project that has a BuildArtifact containing two files `newman.development.env.json` and `newman.tests.json` (see below for expected file contents)
2. Clone this repo to your computer
3. Visit https://console.aws.amazon.com/lambda/home?region=us-east-1#/create/function and create a new function using this repo as the function code
4. Go to your CodePipeline and create a new Action Group *after* your build stage
5. Select the `Action Provider` as `AWS Lambda`
6. Set your `Input Artifact` as your `BuildArtifact` which contains the two files metioned in stpe #1
7. For the `Function Name` select the new Lambda function you created.
8. After saving - once your CodePipeline pipeline runs, it should run the newman tests after your build stage. If there are failures, it will report it in the pipeline as a failure.

## Example files

*newman.development.env.json*
```json
{
    "id": "f690e60b-e227-43d9-852d-ed9b6f84c88d",
    "name": "Development",
    "values": [
        {
            "key": "api_path",
            "value": "http://testing.service/path",
            "enabled": true
        }
    ],
    "_postman_variable_scope": "environment",
    "_postman_exported_at": "2019-10-24T16:03:11.202Z",
    "_postman_exported_using": "Postman/7.9.0"
}
```

*newman.tests.json*
```json
{
    "variables": [],
    "info": {
        "name": "file-upload",
        "_postman_id": "9dbfcf22-fdf4-f328-e440-95dbd8e4cfbb",
        "description": "A set of `POST` requests to upload files as form data fields",
        "schema": "https://schema.getpostman.com/json/collection/v2.0.0/collection.json"
    },
    "item": [
        {
            "name": "Form data upload",
            "event": [
                {
                    "listen": "test",
                    "script": {
                        "type": "text/javascript",
                        "exec": [
                            "var response = JSON.parse(responseBody).files[\"sample-file.txt\"];",
                            "",
                            "tests[\"Status code is 200\"] = responseCode.code === 200;",
                            "tests[\"File was uploaded correctly\"] = /^data:application\\/octet-stream;base64/.test(response);",
                            ""
                        ]
                    }
                }
            ],
            "request": {
                "url": {
                    "raw": "{{api_path}}",
                     "host": [
                        "{{api_path}}"
                    ]
                },
                "method": "POST",
                "header": [],
                "body": {
                    "mode": "formdata",
                    "formdata": [
                        {
                            "key": "file",
                            "type": "file",
                            "enabled": true,
                            "src": "sample-file.txt"
                        }
                    ]
                },
                "description": "Uploads a file as a form data field to `https://echo.getpostman.com/post` via a `POST` request."
            },
            "response": []
        }
    ]
}
```

## TODO
* Use environment variables for the environment and newman test file names.
* Clean-up for release...

## License
This project is open-sourced software licensed under the MIT license.
