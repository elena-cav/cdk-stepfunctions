import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { aws_lambda_nodejs as lambdaNode } from "aws-cdk-lib";
import { aws_events as events } from "aws-cdk-lib";
import { aws_events_targets as eventsTarget } from "aws-cdk-lib";
import { EventBridgeTypes } from "../lambdas/send-email";
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

    // Create an EventBus to receive and send events.

    // Define the wait task.
    // Because we're subscribing to an EventBridge event, the "at" field
    // is under the detail.
    const waitTask = new sfn.Wait(this, "waitUntil", {
      time: sfn.WaitTime.timestampPath("$.time"),
    });
    const eventBridgeLogs = new logs.LogGroup(this, "NotificationStackLogs");
    // Define the sendReminder task.
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
    // Grant permission to send to the bus.
    props.eventBus.grantPutEventsTo(sendEmailLambda);
    // Set up the Lambda function to be a task.
    const sendEmailTask = new tasks.LambdaInvoke(this, "sendReminder", {
      lambdaFunction: sendEmailLambda,
      outputPath: "$.Payload", // Return the output from the Lambda function.
    });

    // Configure a delay for the sendReminderTask.
    const reminderMachineDefinition = waitTask.next(sendEmailTask);

    // Construct the state machine.
    const reminderMachine = new sfn.StateMachine(this, "EventBridgeMachine", {
      definition: reminderMachineDefinition,
      timeout: Duration.days(90),
      logs: {
        destination: eventBridgeLogs,
        level: sfn.LogLevel.ALL,
      },
    });
    sendEmailLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
        effect: Effect.ALLOW,
      })
    );
    // Configure EventBridge to start the reminder machine when a remind event is received.
    const reminderMachineTarget = new eventsTarget.SfnStateMachine(
      reminderMachine
    );
    new events.Rule(this, "startEmailSender", {
      eventBus: props.eventBus,
      targets: [reminderMachineTarget],
      eventPattern: {
        detailType: [EventBridgeTypes.StartEmailSender],
      },
    });
  }
}
