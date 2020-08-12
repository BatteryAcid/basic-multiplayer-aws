const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
require('./patch.js');
let send = undefined;

function init(event) {
   console.log(event)
   const apigwManagementApi = new AWS.ApiGatewayManagementApi({
      apiVersion: '2018-11-29',
      endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
   });
   send = async (connectionId, data) => {
      await apigwManagementApi.postToConnection({
         ConnectionId: connectionId,
         Data: `Echo: ${data}`
      }).promise();

   }
}

function getConnections() {
   return ddb.scan({
      TableName: 'chat',
   }).promise();

}

exports.handler = (event, context, callback) => {
   console.log("Event received");
   init(event);
   let message = JSON.parse(event.body).message;
   console.log("message:");
   console.log(message);

   getConnections().then((data) => {
      console.log(data.Items);
      data.Items.forEach(function(connection) {
         console.log("Connection " + connection.connectionid);
         send(connection.connectionid, message);
      });
   });

   return callback(null, {
      statusCode: 200,
   });
};