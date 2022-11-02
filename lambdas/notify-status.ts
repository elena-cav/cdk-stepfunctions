import { StepFunctions } from "aws-sdk";
import { SQSHandler, SQSEvent, SQSRecord } from "aws-lambda";
import axios from "axios";

const sfn = new StepFunctions({ apiVersion: "2016-11-23" });
interface ATGEvent {
  MyTaskToken: string;
  Record: {
    value: {
      Payload: {
        insuranceProductId: string;
        brand: string;
        productContentId: number;
        termDescription: string;
        isAutoRenewable: boolean;
        productTypeCode: number;
        productLineId: string;
        sku: string;
        suffix: string;
        outletCode: string;
        productDescription: string;
      };
      CorrelationId: string;
      TimeStamp: string;
      MyTaskToken: string;
    };
  };
}

export const handler = async function (event: SQSEvent) {
  console.log("Ingesting Insurance Created event");
  console.log(JSON.stringify(event));
  let result: any | undefined = undefined;

  const payloads: ATGEvent[] =
    event.Records?.map((record: SQSRecord) => JSON.parse(record.body)) || [];

  console.log("Formatting events to send to ATG");
  console.log(JSON.stringify(payloads));

  console.log("Pre-promises step");
  const promises = payloads.map((payload) => {
    console.log("DETAIL", payload.Record.value);
    return new Promise((resolve, reject) =>
      axios
        .post(`${process.env.ATG_ENDPOINT}atg` || "", payload.Record.value)
        .then(async (response) => {
          console.log(
            `Successful response: ${response?.status}. Correlation ID: ${payloads[0].Record.value.CorrelationId}`
          );

          const sendSuccess: StepFunctions.SendTaskSuccessInput = {
            output: JSON.stringify({
              statusCode: 200,
              headers: { "Content-Type": "text/json" },
              postStatus: {
                correlationId: payload.Record.value.CorrelationId,
              },
            }),
            taskToken: payload.MyTaskToken,
          };
          console.log("SENDSUCCESS", sendSuccess);
          sfn
            .sendTaskSuccess(sendSuccess, (err: any, data: any) => {
              if (err) console.log(err, err.stack);
              else console.log("DATA", data);
            })
            .promise();

          return sendSuccess;
        })
        .catch(async (err) => {
          console.log(
            `Error posting payload: ${err.message}. Status Code: ${err.status}`
          );
          const sendFailure: StepFunctions.SendTaskFailureInput = {
            error: JSON.stringify(err),
            cause: JSON.stringify({
              statusCode: 500,
              headers: { "Content-Type": "text/json" },
              putStatus: {
                messageId: payload.Record.value.CorrelationId,
                ProcessorResult: err,
              },
            }),
            taskToken: payload.MyTaskToken,
          };
          console.log(sendFailure);
          await sfn.sendTaskFailure(sendFailure, (err: any, data: any) => {
            if (err) console.log("err", err, err.stack);
            else console.log("err DATA", data);
          });
          return sendFailure;
        })
    );
  });

  console.log("Promises", promises);

  await Promise.allSettled(promises);
};
