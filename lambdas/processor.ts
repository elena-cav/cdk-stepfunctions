export const handler = async (event: any) => {
  console.log("processor lambda", event);

  return {
    status: "SUCCEEDED",
    event,
  };
};
