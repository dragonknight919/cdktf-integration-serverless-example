import { Resource } from "cdktf";
import { NodejsFunction } from "../../lib/nodejs-function";
import { Construct } from "constructs";
import * as aws from '@cdktf/provider-aws';
import path = require("path");

const lambdaRolePolicy = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": "sts:AssumeRole",
            "Principal": {
                "Service": "lambda.amazonaws.com"
            },
            "Effect": "Allow",
            "Sid": ""
        }
    ]
}

interface PostsApiOptions {
    environment: string;
    table: aws.DynamodbTable;
}

export class PostsApi extends Resource {
    /**
     * base url on which the methods of the posts api can be invoked
     * e.g. GET <endpoint>/posts
     */
    endpoint: string;

    constructor(scope: Construct, id: string, options: PostsApiOptions) {
        super(scope, id)

        // api lambda tf resources
        const code = new NodejsFunction(this, 'code', {
            path: path.join(__dirname, 'lambda/index.ts')
        });

        // Create Lambda role
        const role = new aws.IamRole(this, "lambda-exec", {
            name: `sls-example-post-api-lambda-exec-${options.environment}`,
            assumeRolePolicy: JSON.stringify(lambdaRolePolicy),
            inlinePolicy: [{
                name: 'AllowDynamoDB',
                policy: JSON.stringify({
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Action": [
                                "dynamodb:*"
                            ],
                            "Resource": options.table.arn,
                            "Effect": "Allow"
                        }
                    ]
                }),
            }]
        })

        // Add execution role for lambda to write to CloudWatch logs
        new aws.IamRolePolicyAttachment(this, "lambda-managed-policy", {
            policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
            role: role.name
        })

        // Create Lambda function
        const lambda = new aws.LambdaFunction(this, "api", {
            functionName: `sls-example-posts-api-${options.environment}`,
            handler: 'index.handler',
            runtime: 'nodejs10.x',
            role: role.arn,
            filename: code.asset.path,
            sourceCodeHash: code.asset.assetHash,
            environment: [{
                variables: {
                    DYNAMODB_TABLE_NAME: options.table.name
                }
            }]
        });

        // Create and configure API gateway
        const api = new aws.Apigatewayv2Api(this, 'api-gw', {
            name: `sls-example-posts-${options.environment}`,
            protocolType: 'HTTP',
            target: lambda.arn,
            corsConfiguration: [{
                allowOrigins: ['*'],
                allowMethods: ['*'],
                allowHeaders: ['content-type'],
            }]
        })

        new aws.LambdaPermission(this, 'apigw-lambda', {
            functionName: lambda.functionName,
            action: 'lambda:InvokeFunction',
            principal: 'apigateway.amazonaws.com',
            sourceArn: `${api.executionArn}/*/*`,
        })

        this.endpoint = api.apiEndpoint;
    }
}