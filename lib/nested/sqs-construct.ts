import { Queue } from "aws-cdk-lib/aws-sqs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { SqsSendMessage } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { NestedStack, NestedStackProps } from "aws-cdk-lib";

export class nestedSqsStack extends NestedStack {
  public readonly deadLetterQueue: Queue;
  public readonly queueMessages: SqsSendMessage;
  public readonly queue: Queue;

  constructor(scope: Construct, id: string, props?: NestedStackProps) {
    super(scope, id, props);

    this.deadLetterQueue = new Queue(this, "dead-letter-queue", {
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.queue = new Queue(this, "receiver-queue", {
      retentionPeriod: Duration.days(5),
      removalPolicy: RemovalPolicy.DESTROY,
      deliveryDelay: Duration.seconds(3),
      visibilityTimeout: Duration.minutes(100),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 1,
      },
    });

    this.queueMessages = new SqsSendMessage(this, "SQS", {
      queue: this.queue,
      inputPath: "$",
      messageBody: sfn.TaskInput.fromObject({
        Record: sfn.TaskInput.fromJsonPathAt("$"),
      }),
      resultSelector: { "Payload.$": "$" },
      resultPath: "$.recordResult",
    });
  }
}
