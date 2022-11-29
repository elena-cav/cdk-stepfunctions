#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { StepStack } from "../lib/stacks/step-stack";
import { CdkEventbridgeStepfunctionStack } from "../lib/stacks/eventbridge-stack";

const app = new cdk.App();
new StepStack(app, "StepStack", {

});
new CdkEventbridgeStepfunctionStack(app, "EventBridgeStack", {
  eventBus: StepStack.eventBus,
});
