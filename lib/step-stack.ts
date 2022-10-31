import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

export class StepStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const receiverLambda = new NodejsFunction(this, "receiver-lambda", {
      entry: "./lambdas/receiver.ts",
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: cdk.Duration.seconds(3),
    });
    const deadLetterQueue = new sqs.Queue(
      this,
      "dead-letter-queue"
      // {
      //   retentionPeriod: cdk.Duration.minutes(30),
      // }
    );

    const queue = new sqs.Queue(this, "receiver-queue", {
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 1,
      },
    });

    const getStatusLambda = new NodejsFunction(this, "get-status-lambda", {
      entry: "./lambdas/get-status.ts",
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: cdk.Duration.seconds(3),
    });

    const loggerLambda = new NodejsFunction(this, "logger-lambda", {
      entry: "./lambdas/logger.ts",
      runtime: lambda.Runtime.NODEJS_14_X,
      timeout: cdk.Duration.seconds(3),
    });
    // new tasks.EmrCreateCluster(this, "Create Cluster", {
    //   instances: {},
    //   name: sfn.TaskInput.fromJsonPathAt("$.ClusterName").value,
    //   stepConcurrencyLevel: 10,
    // });

    const processorLambda = new NodejsFunction(this, "processor-lambda", {
      entry: "./lambdas/processor.ts",
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: cdk.Duration.seconds(3),
    });
    const jobFailed = new sfn.Fail(this, "Job Failed", {
      cause: "AWS Batch Job Failed",
      error: "DescribeJob returned FAILED",
    });
    const receiveJob = new tasks.LambdaInvoke(this, "Receive Job", {
      lambdaFunction: receiverLambda,
      outputPath: "$.Payload",
    });

    const processJob = new tasks.LambdaInvoke(this, "Submit Job", {
      lambdaFunction: processorLambda,
      outputPath: "$.Payload",
    });

    const wait30 = new sfn.Wait(this, "Wait 30 Seconds", {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(30)),
    });

    const getStatus = new tasks.LambdaInvoke(this, "Get Job Status", {
      lambdaFunction: getStatusLambda,
      // inputPath: "$.MessageBody.CorrelationId",
      outputPath: "$.Payload",
    });

    const finalStatus = new tasks.LambdaInvoke(this, "Get Final Job Status", {
      lambdaFunction: getStatusLambda,
      // inputPath: "$.MessageBody.CorrelationId",
      outputPath: "$.Payload",
    });

    const queueMessages = new tasks.SqsSendMessage(this, "SQS", {
      queue,
      // outputPath: "$",
      // inputPath: "$",
      resultPath: "$.taskresult",
      messageBody: sfn.TaskInput.fromJsonPathAt("$"),
      // messageBody: sfn.TaskInput.fromJsonPathAt("$.MessageBody"),

      // messageBody: sfn.TaskInput.fromObject({
      //   "input.$": "$",
      // }),
    });
    getStatusLambda.addEventSource(
      new SqsEventSource(queue, {
        batchSize: 10,
      })
    );

    const definition = new sfn.Pass(this, "PassTask")
      .next(queueMessages)
      // .next(wait30)
      .next(getStatus)
      .next(receiveJob)
      .next(processJob)
      .next(
        new sfn.Choice(this, "Job Complete?")
          .when(sfn.Condition.stringEquals("$.status", "FAILED"), jobFailed)
          .when(
            sfn.Condition.stringEquals("$.status", "SUCCEEDED"),
            finalStatus
          )
          .otherwise(wait30)
      );
    const stepFunctionsLogGroup = new logs.LogGroup(this, "MyLogGroup");

    const APIOrchestratorMachine = new sfn.StateMachine(this, "StateMachine", {
      definition,
      logs: {
        destination: stepFunctionsLogGroup,
        level: sfn.LogLevel.ALL,
      },
      timeout: cdk.Duration.minutes(5),
    });

    const API = new apigw.RestApi(this, "step-apigw", {
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ["*"],
        allowCredentials: true,
      },
    });

    const credentialsRole = new iam.Role(this, "getRole", {
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
    });

    credentialsRole.attachInlinePolicy(
      new iam.Policy(this, "getPolicy", {
        statements: [
          new iam.PolicyStatement({
            actions: ["states:StartExecution"],
            effect: iam.Effect.ALLOW,
            resources: [APIOrchestratorMachine.stateMachineArn],
          }),
        ],
      })
    );

    const createPetResource = API.root.addResource("dequeuewarrantyproduct");

    createPetResource.addMethod(
      "POST",

      new apigw.AwsIntegration({
        service: "states",
        action: "StartExecution",
        integrationHttpMethod: "POST",
        options: {
          passthroughBehavior: apigw.PassthroughBehavior.NEVER,
          credentialsRole,
          requestParameters: {
            "integration.request.header.Content-Type": `'application/x-www-form-urlencoded'`,
          },
          requestTemplates: {
            "application/json": `{
                  "input": "{\\"actionType\\": \\"create\\", \\"body\\": $util.escapeJavaScript($input.json('$'))}",
                  "stateMachineArn": "${APIOrchestratorMachine.stateMachineArn}"
                }`,
          },
          integrationResponses: [
            {
              statusCode: "200",
            },
            {
              statusCode: "400",
            },
            {
              statusCode: "500",
            },
          ],
        },
      }),
      {
        methodResponses: [
          {
            statusCode: "400",
          },
          {
            statusCode: "200",
          },
          {
            statusCode: "500",
          },
        ],
      }
    );
  }
}
