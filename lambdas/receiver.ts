// import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
// import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
// import AWS from "aws-sdk";

export const handler = async (event: any) => {
  console.log("receiver lambda", event);

  return {
    status: "SUCCEEDED",
    event,
  };
};
