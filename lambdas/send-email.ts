import { EventBridgeEvent, Context } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export enum EventBridgeTypes {
  StartEmailSender = "StartEmailSender",
}

interface Payload {
  insuranceProductId: string;
  teamEmail: string;
}

interface Input {
  Payload: Payload;
}

export interface Event {
  at: Date;
  input: Input;
}

const sesClient = new SESClient({ region: "eu-west-1" });

const sendEmail = async (teamEmail: string, insuranceProductId: string) => {
  console.log("EMAIL SENDER", process.env.EMAIL_SENDER);
  console.log("EMAIL ADDRESS", teamEmail);
  const response = await sesClient.send(
    new SendEmailCommand({
      Destination: {
        ToAddresses: [teamEmail],
      },
      Source: process.env.EMAIL_SENDER,
      Message: {
        Subject: { Data: `New Warranty Product` },
        Body: {
          Text: {
            Data: `New Warranty Product published - Insurance ID: ${insuranceProductId}`,
          },
        },
      },
    })
  );
  console.log("RESPONSE", response);
};

export const handler = async (
  event: EventBridgeEvent<EventBridgeTypes.StartEmailSender, Event>,
  _context: Context
) => {
  console.log("EVENT", event);
  console.log("payload", event.detail.input.Payload);
  const { teamEmail, insuranceProductId } = event.detail.input.Payload;

  try {
    sendEmail(teamEmail, insuranceProductId);

    return { statusCode: 200, body: "Email sent" };
  } catch (error) {
    console.log("ERROR", error);

    return { statusCode: 500, body: error };
  }
};
