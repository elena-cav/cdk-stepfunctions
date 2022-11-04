// import { StepFunctions } from "aws-sdk";
// import { SQSHandler, SQSEvent, SQSRecord } from "aws-lambda";
// import axios from "axios";

// const sfn = new StepFunctions({ apiVersion: "2016-11-23" });
// interface ATGEvent {
//   MyTaskToken: string;
//   Record: {
//     value: {
//       body: {
//         Payload: {
//           insuranceProductId: string;
//           brand: string;
//           productContentId: number;
//           termDescription: string;
//           isAutoRenewable: boolean;
//           productTypeCode: number;
//           productLineId: string;
//           sku: string;
//           suffix: string;
//           outletCode: string;
//           productDescription: string;
//         };
//         CorrelationId: string;
//         TimeStamp: string;
//         MyTaskToken: string;
//       };
//     };
//   };
// }

// export const handler = async function (event: SQSEvent) {
//   console.log("Ingesting Insurance Created event");
//   console.log(JSON.stringify(event));

//   const payloads: ATGEvent[] =
//     event.Records?.map((record: SQSRecord) => JSON.parse(record.body)) || [];

//   console.log("Formatting events to send to ATG");
//   console.log(JSON.stringify(payloads));

//   console.log("Pre-promises step");
//   const promises = payloads.map((payload) => {
//     console.log("DETAIL", payload.Record.value);
//     return new Promise(() =>
//       // return
//       axios
//         .post(`${process.env.ATG_ENDPOINT}atg` || "", payload.Record.value)
//         .then(async (response) => {
//           console.log(
//             `Successful response: ${response?.status}. Correlation ID: ${payloads[0].Record.value.body.CorrelationId}`
//           );
//           //   return {
//           //     status: "SUCCEEDED",
//           //   };

//           const sendSuccess: StepFunctions.SendTaskSuccessInput = {
//             output: JSON.stringify({
//               statusCode: 200,
//               headers: { "Content-Type": "text/json" },
//               postStatus: {
//                 correlationId: payload.Record.value.body.CorrelationId,
//               },
//             }),
//             taskToken: payload.MyTaskToken,
//           };
//           console.log("SENDSUCCESS", sendSuccess);
//           await sfn
//             .sendTaskSuccess(sendSuccess, (err: any, data: any) => {
//               if (err) console.log(err, err.stack);
//               else console.log("DATA", data);
//             })
//             .promise();

//           return sendSuccess;
//         })
//         .catch(async (err) => {
//           console.log(
//             `Error posting payload: ${err.message}. Status Code: ${err.status}`
//           );
//           //   return {
//           //     status: "FAILED",
//           //   };
//           const sendFailure: StepFunctions.SendTaskFailureInput = {
//             error: JSON.stringify(err),
//             cause: JSON.stringify({
//               statusCode: 500,
//               headers: { "Content-Type": "text/json" },
//               postStatus: {
//                 correlationId: payload.Record.value.body.CorrelationId,
//                 ProcessorResult: err,
//               },
//             }),
//             taskToken: payload.MyTaskToken,
//           };
//           console.log(sendFailure);
//           await sfn.sendTaskFailure(sendFailure, (err: any, data: any) => {
//             if (err) console.log("err", err, err.stack);
//             else console.log("err DATA", data);
//           });
//           return sendFailure;
//         })
//     );
//   });

//   console.log("Promises", promises);

//   return await Promise.all(promises);
// };
import axios from "axios";

import { StepFunctions } from "aws-sdk";

// const sfn = new StepFunctions({ apiVersion: "2016-11-23" });
// export const handler = async function (event: any) {
//   console.log("EVENT", event);
//   await Promise.all(
//     event.Records?.map(async (Record: any) => {
//       const body = JSON.parse(Record.body).Record.value.body;

//       try {
//         axios
//           .post(`${process.env.ATG_ENDPOINT}atg` || "", body)
//           .then(async (response) => {
//             console.log(
//               `Successful response: ${response?.status}. Correlation ID: ${body.CorrelationId}`
//             );
//           });
//         console.log(
//           "HERE",
//           JSON.parse(Record.body),
//           JSON.parse(Record.body).MyTaskToken
//         );
//       } catch (err) {
//         const sendFailure: StepFunctions.SendTaskFailureInput = {
//           error: JSON.stringify(err),
//           cause: JSON.stringify({
//             statusCode: 500,
//             headers: { "Content-Type": "text/json" },
//             postStatus: {
//               correlationId: body.CorrelationId,
//               ProcessorResult: err,
//             },
//           }),
//           taskToken: JSON.parse(Record.body).MyTaskToken,
//         };
//         console.log(sendFailure);
//         await sfn.sendTaskFailure(sendFailure, function (err: any, data: any) {
//           if (err) console.log(err, err.stack);
//           else console.log(data);
//         });
//         return sendFailure;
//       }
//       const sendSuccess: StepFunctions.SendTaskSuccessInput = {
//         output: JSON.stringify({
//           statusCode: 200,
//           headers: { "Content-Type": "text/json" },
//           putStatus: {
//             correlationId: body.CorrelationId,
//           },
//         }),
//         taskToken: JSON.parse(Record.body).MyTaskToken,
//       };

//       console.log(sendSuccess);

//       await sfn
//         .sendTaskSuccess(sendSuccess, function (err: any, data: any) {
//           if (err) console.log(err, err.stack);
//           else console.log(data);
//         })
//         .promise();

//       return sendSuccess;
//     })
//   );
// };

const sfn = new StepFunctions({ apiVersion: "2016-11-23" });
export const handler = async function (event: any) {
  console.log("EVENT", event);

  try {
    const response = await axios.post(
      `${process.env.ATG_ENDPOINT}atg` || "",
      event.input.body
    );
    console.log(
      `Successful response: ${response?.status}. Correlation ID: ${event.input.body.CorrelationId}`
    );

    const sendSuccess: StepFunctions.SendTaskSuccessInput = {
      output: JSON.stringify({
        statusCode: 200,
        headers: { "Content-Type": "text/json" },
        putStatus: {
          correlationId: event.input.body.CorrelationId,
        },
      }),
      taskToken: event.token,
    };

    console.log(sendSuccess);

    await sfn
      .sendTaskSuccess(sendSuccess, function (err: any, data: any) {
        if (err) console.log(err, err.stack);
        else console.log(data);
      })
      .promise();

    return sendSuccess;
  } catch (err) {
    console.log("IN ERROR", err);
    const sendFailure: StepFunctions.SendTaskFailureInput = {
      error: JSON.stringify(err),
      cause: JSON.stringify({
        statusCode: 500,
        headers: { "Content-Type": "text/json" },
        postStatus: {
          correlationId: event.input.body.CorrelationId,
          ProcessorResult: err,
        },
      }),
      taskToken: event.token,
    };
    console.log(sendFailure);
    await sfn.sendTaskFailure(sendFailure, function (err: any, data: any) {
      if (err) console.log(err, err.stack);
      else console.log(data);
    });
    return {
      statusCode: 500,
    };
  }
};
