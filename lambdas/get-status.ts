export const handler = async (event: any) => {
  console.log("get-status lambda", event);
  return {
    status: "SUCCEEDED",
    event,
  };
};

// {
//     "TimeStamp": 1657805349101,
//     "CorrelationId": "28d92c1c-0268-4599-9650-a0a2faea2f54",
//     "event": "insuranceProductCreatedv1",
//     "source": "fs-ins-productPricing",
//     "Payload": {
//         "insuranceProductId": 58305195,
//         "brand": "LAI",
//         "productContentId": 2,
//         "termDescription": "2 Year Insurance",
//         "sellingPrice": 29.99,
//         "weeklyPrices": [
//             {
//                 "numberOfWeeks": 20,
//                 "weeklySellingPrice": 1.5
//             },
//             {
//                 "numberOfWeeks": 52,
//                 "weeklySellingPrice": 0.38
//             }
//         ],
//         "isAutoRenewable": false,
//         "productTypeCode": 10,
//         "productLineId": "IN481",
//         "sku": 1,
//         "suffix": "4X",
//         "outletCode": "A241",
//         "productDescription": "Protect Repair Insurance Postman"
//     }
// }
