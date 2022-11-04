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
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";

export class StepStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stubAPI = new apigw.RestApi(this, "atg-stub-apigw", {
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ["*"],
        allowCredentials: true,
      },
    });

    stubAPI.root.addResource("atg").addMethod(
      "POST",
      new apigw.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
          },
        ],
        passthroughBehavior: apigw.PassthroughBehavior.NEVER,
        requestTemplates: {
          "application/json": '{ "statusCode": 200 }',
        },
      }),
      {
        methodResponses: [{ statusCode: "200" }],
      }
    );

    const deadLetterQueue = new sqs.Queue(this, "dead-letter-queue", {
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const queue = new sqs.Queue(this, "receiver-queue", {
      retentionPeriod: cdk.Duration.days(5),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deliveryDelay: cdk.Duration.seconds(3),
      visibilityTimeout: cdk.Duration.minutes(100),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 1,
      },
    });

    const notifyStatusLambda = new NodejsFunction(
      this,
      "notify-status-lambda",
      {
        entry: "./lambdas/notify-status.ts",
        runtime: lambda.Runtime.NODEJS_12_X,
        timeout: cdk.Duration.seconds(3),
        environment: {
          ATG_ENDPOINT: stubAPI.url,
        },
      }
    );

    notifyStatusLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:SendTaskSuccess", "states:SendTaskFailure"],
        resources: ["*"],
        effect: Effect.ALLOW,
      })
    );

    // const jobFailed = new sfn.Fail(this, "Job Failed", {
    //   cause: "AWS Batch Job Failed",
    //   error: "DescribeJob returned FAILED",
    // });

    const jobFailed = new sfn.Fail(this, "Job Failed", {
      comment: "Job Failed",
    });
    const jobSucceed = new sfn.Succeed(this, "Job Succeed", {
      comment: "Job Succeed",
    });
    const checkStatus = new sfn.Choice(
      this,
      "Check Status?"
      // , {inputPath: "$.recordResult",}
    )
      .when(sfn.Condition.numberEquals("$.Payload.statusCode", 500), jobFailed)
      .when(sfn.Condition.numberEquals("$.statusCode", 200), jobSucceed)
      .otherwise(jobFailed);

    const wait30 = new sfn.Wait(this, "Wait 30 Seconds", {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(30)),
    });

    const sfnTaskPayload = sfn.TaskInput.fromObject({
      // MyTaskToken: sfn.JsonPath.taskToken,
      Record: sfn.TaskInput.fromJsonPathAt("$"),
    });

    const queueMessages = new tasks.SqsSendMessage(this, "SQS", {
      queue,
      // integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      inputPath: "$",
      messageBody: sfnTaskPayload,
      resultSelector: { "Payload.$": "$" },
      resultPath: "$.recordResult",
    });

    const notifyStatus = new tasks.LambdaInvoke(this, "Notify Status", {
      lambdaFunction: notifyStatusLambda,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        token: sfn.JsonPath.taskToken,
        input: sfn.JsonPath.stringAt("$"),
      }),
    });

    notifyStatusLambda.addEventSource(
      new SqsEventSource(queue, {
        batchSize: 2,
        maxBatchingWindow: cdk.Duration.seconds(10),
      })
    );

    const definition = new sfn.Pass(this, "PassTask")
      .next(queueMessages)
      .next(notifyStatus)

      .next(checkStatus);
    const stepFunctionsLogGroup = new logs.LogGroup(
      this,
      "StepFunctionsLogGroup"
    );

    const APIOrchestratorMachine = new sfn.StateMachine(this, "StateMachine", {
      definition,
      logs: {
        destination: stepFunctionsLogGroup,
        level: sfn.LogLevel.ALL,
      },

      timeout: cdk.Duration.minutes(2),
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
