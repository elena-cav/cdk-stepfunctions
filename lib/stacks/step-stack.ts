import { nestedSqsStack } from "../nested/sqs-nested-stack";
import {
  nestedApiStack,
  nestedStubApisStack,
} from "../nested/apis-nested-stack";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import {
  StateMachine,
  LogLevel,
  Choice,
  Condition,
  TaskInput,
  JsonPath,
  Fail,
  Pass,
} from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { EventBridgeTypes } from "../../lambdas/send-email";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { aws_events as events } from "aws-cdk-lib";

export class StepStack extends Stack {
  static eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const { queue, queueMessages } = new nestedSqsStack(this, "nested-sqs");
    const { stubAPI } = new nestedStubApisStack(this, "nested-stub-api");

    const postEventLambda = new NodejsFunction(this, "send-event-lambda", {
      entry: "./lambdas/send-event.ts",
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: Duration.seconds(3),
      environment: {
        ATG_ENDPOINT: stubAPI.url,
      },
    });
    const passEventApi = new Pass(this, "PassApiEvent");

    const postEvent = new tasks.LambdaInvoke(this, "Post Event", {
      lambdaFunction: postEventLambda,
      payload: TaskInput.fromObject({
        input: JsonPath.stringAt("$"),
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
            detail: TaskInput.fromObject({
              input: JsonPath.stringAt("$"),
            }),
            eventBus: StepStack.eventBus,
            detailType: EventBridgeTypes.StartEmailSender,
            source: "step.functions",
          },
        ],
      }
    );

    const jobFailed = new Fail(this, "Job Failed", {
      comment: "Job Failed",
    });

    const definition = passEventApi
      .next(queueMessages)
      .next(postEvent)
      .next(
        new Choice(this, "Check Status?")
          .when(
            Condition.numberEquals("$.Payload.statusCode", 200),
            eventBridgeTask
          )
          .otherwise(jobFailed)
      );
    const stepFunctionsLogGroup = new LogGroup(
      this,
      "ProductProcessorLogGroup"
    );
    const APIOrchestratorMachine = new StateMachine(
      this,
      "ProductProcessorMachine",
      {
        definition,
        logs: {
          destination: stepFunctionsLogGroup,
          level: LogLevel.ALL,
        },

        timeout: Duration.minutes(2),
      }
    );

    new nestedApiStack(this, "nested-api", {
      APIOrchestratorMachine,
    });
  }
}
