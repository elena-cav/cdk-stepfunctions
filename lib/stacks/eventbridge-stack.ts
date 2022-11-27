import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { aws_lambda_nodejs as lambdaNode } from "aws-cdk-lib";
import { aws_events as events } from "aws-cdk-lib";
import { aws_events_targets as eventsTarget } from "aws-cdk-lib";
import { EventBridgeTypes } from "../../lambdas/send-email";
import * as logs from "aws-cdk-lib/aws-logs";

interface CdkEventbridgeStepfunctionStackProps extends StackProps {
  eventBus: events.EventBus;
}

export class CdkEventbridgeStepfunctionStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: CdkEventbridgeStepfunctionStackProps
  ) {
    super(scope, id, props);

    const waitTask = new sfn.Wait(this, "waitUntil", {
      time: sfn.WaitTime.timestampPath("$.time"),
    });
    const eventBridgeLogs = new logs.LogGroup(this, "NotificationStackLogs");

    const sendEmailLambda = new lambdaNode.NodejsFunction(this, "send-email", {
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: "handler",
      entry: "./lambdas/send-email.ts",
      memorySize: 1024,
      environment: {
        EMAIL_SENDER: "elena.cavallero@and.digital",
        EVENT_BUS: props.eventBus.eventBusName,
      },
    });
    props.eventBus.grantPutEventsTo(sendEmailLambda);

    const sendEmailTask = new tasks.LambdaInvoke(this, "sendNotification", {
      lambdaFunction: sendEmailLambda,
      outputPath: "$.Payload",
    });

    const jobFailed = new sfn.Fail(this, "Job Failed", {
      comment: "Job Failed",
    });

    const jobSucceeded = new sfn.Succeed(this, "Job Succeeded", {
      comment: "Job Succeeded",
    });
    const checkStatus = new sfn.Choice(this, "Check Status?")
      .when(sfn.Condition.numberEquals("$.StatusCode", 200), jobSucceeded)
      .otherwise(jobFailed);

    const notificationMachineDefinition = waitTask
      .next(sendEmailTask)
      .next(checkStatus);

    const notificationMachine = new sfn.StateMachine(
      this,
      "NotificationMachine",
      {
        definition: notificationMachineDefinition,
        timeout: Duration.days(90),
        logs: {
          destination: eventBridgeLogs,
          level: sfn.LogLevel.ALL,
        },
      }
    );
    sendEmailLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
        effect: Effect.ALLOW,
      })
    );
    const notificationMachineTarget = new eventsTarget.SfnStateMachine(
      notificationMachine
    );
    new events.Rule(this, "startEmailSender", {
      eventBus: props.eventBus,
      targets: [notificationMachineTarget],
      eventPattern: {
        detailType: [EventBridgeTypes.StartEmailSender],
      },
    });
  }
}
