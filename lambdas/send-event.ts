import axios from "axios";

export const handler = async function (event: any) {
  console.log("EVENT", event);
  const { body } = event.input;
  try {
    const response = await axios.post(
      `${process.env.ATG_ENDPOINT}atg` || "",
      body
    );
    console.log(
      `Successful response: ${response?.status}. Correlation ID: ${event.input.body.CorrelationId}`
    );
    return {
      insuranceProductId: body.Payload.insuranceProductId,
      teamEmail: body.Payload.teamEmail,
      statusCode: 200,
    };
  } catch (err) {
    console.log("IN ERROR", err);

    return {
      statusCode: 500,
    };
  }
};
