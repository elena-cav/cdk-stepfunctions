import { Construct } from "constructs";
import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import {
  RestApi,
  Cors,
  MockIntegration,
  AwsIntegration,
  PassthroughBehavior,
} from "aws-cdk-lib/aws-apigateway";
import { StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import * as iam from "aws-cdk-lib/aws-iam";

interface NestedApiStackProps extends NestedStackProps {
  APIOrchestratorMachine: StateMachine;
}

export class nestedStubApisStack extends NestedStack {
  public readonly stubAPI: RestApi;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.stubAPI = new RestApi(this, "atg-stub-apigw", {
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["*"],
        allowCredentials: true,
      },
    });

    this.stubAPI.root.addResource("atg").addMethod(
      "POST",
      new MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
          },
        ],
        passthroughBehavior: PassthroughBehavior.NEVER,
        requestTemplates: {
          "application/json": '{ "statusCode": 200 }',
        },
      }),
      {
        methodResponses: [{ statusCode: "200" }],
      }
    );
  }
}

export class nestedApiStack extends NestedStack {
  public readonly API: RestApi;

  constructor(scope: Construct, id: string, props: NestedApiStackProps) {
    super(scope, id, props);

    this.API = new RestApi(this, "step-apigw", {
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
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
            resources: [props.APIOrchestratorMachine.stateMachineArn],
          }),
        ],
      })
    );

    const createPetResource = this.API.root.addResource(
      "dequeuewarrantyproduct"
    );

    createPetResource.addMethod(
      "POST",

      new AwsIntegration({
        service: "states",
        action: "StartExecution",
        integrationHttpMethod: "POST",
        options: {
          passthroughBehavior: PassthroughBehavior.NEVER,
          credentialsRole,
          requestParameters: {
            "integration.request.header.Content-Type": `'application/x-www-form-urlencoded'`,
          },
          requestTemplates: {
            "application/json": `{
                    "input": "{\\"actionType\\": \\"create\\", \\"body\\": $util.escapeJavaScript($input.json('$'))}",
                    "stateMachineArn": "${props.APIOrchestratorMachine.stateMachineArn}"
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
