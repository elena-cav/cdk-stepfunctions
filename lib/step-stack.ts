import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import { EventBridgeTypes } from "../lambdas/send-email";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
} from "aws-cdk-lib";
import { aws_events as events } from "aws-cdk-lib";

export class StepStack extends Stack {
  static eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
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
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const queue = new sqs.Queue(this, "receiver-queue", {
      retentionPeriod: Duration.days(5),
      removalPolicy: RemovalPolicy.DESTROY,
      deliveryDelay: Duration.seconds(3),
      visibilityTimeout: Duration.minutes(100),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 1,
      },
    });

    const postEventLambda = new NodejsFunction(this, "send-event-lambda", {
      entry: "./lambdas/send-event.ts",
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: Duration.seconds(3),
      environment: {
        ATG_ENDPOINT: stubAPI.url,
      },
    });

    postEventLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["states:SendTaskSuccess", "states:SendTaskFailure"],
        resources: ["*"],
        effect: Effect.ALLOW,
      })
    );

    const jobFailed = new sfn.Fail(this, "Job Failed", {
      comment: "Job Failed",
    });

    const queueMessages = new tasks.SqsSendMessage(this, "SQS", {
      queue,
      inputPath: "$",
      messageBody: sfn.TaskInput.fromObject({
        Record: sfn.TaskInput.fromJsonPathAt("$"),
      }),
      resultSelector: { "Payload.$": "$" },
      resultPath: "$.recordResult",
    });

    const postEvent = new tasks.LambdaInvoke(this, "Post Event", {
      lambdaFunction: postEventLambda,
      payload: sfn.TaskInput.fromObject({
        input: sfn.JsonPath.stringAt("$"),
      }),
    });

    postEventLambda.addEventSource(
      new SqsEventSource(queue, {
        batchSize: 2,
        maxBatchingWindow: Duration.seconds(10),
      })
    );

    StepStack.eventBus = new events.EventBus(this, "EventBus", {
      eventBusName: "NotifyBus",
    });

    new CfnOutput(this, "NotifyBus", {
      value: StepStack.eventBus.eventBusName,
    });

    const eventBridgeTask = new tasks.EventBridgePutEvents(
      this,
      "Send to EventBridge",
      {
        entries: [
          {
            detail: sfn.TaskInput.fromObject({
              input: sfn.JsonPath.stringAt("$"),
            }),
            eventBus: StepStack.eventBus,
            detailType: EventBridgeTypes.StartEmailSender,
            source: "step.functions",
          },
        ],
      }
    );
    const checkStatus = new sfn.Choice(this, "Check Status?")
      .when(sfn.Condition.numberEquals("$.StatusCode", 200), eventBridgeTask)
      .otherwise(jobFailed);

    const definition = new sfn.Pass(this, "PassApiEvent")
      .next(queueMessages)
      .next(postEvent)
      .next(checkStatus);
    const stepFunctionsLogGroup = new logs.LogGroup(
      this,
      "ProductProcessorLogGroup"
    );

    const APIOrchestratorMachine = new sfn.StateMachine(
      this,
      "ProductProcessorMachine",
      {
        definition,
        logs: {
          destination: stepFunctionsLogGroup,
          level: sfn.LogLevel.ALL,
        },

        timeout: Duration.minutes(2),
      }
    );

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
