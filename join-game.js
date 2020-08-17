const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
require('./join-patch.js');
let send = undefined;
const TABLE_NAME = "game-session";
const PLAYING_OP = "11";

function init(event) {
   const apigwManagementApi = new AWS.ApiGatewayManagementApi({
      apiVersion: '2018-11-29',
      endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
   });
   send = async (connectionId, data) => {
      await apigwManagementApi.postToConnection({
         ConnectionId: connectionId,
         Data: `${data}`
      }).promise();
   }
}

function getAvailableGameSession() {
   return ddb.scan({
      TableName: TABLE_NAME,
      FilterExpression: "#p2 = :empty and #status <> :closed",
      ExpressionAttributeNames: {
         "#p2": "player2",
         "#status": "gameStatus"
      },
      ExpressionAttributeValues: {
         ":empty": "empty",
         ":closed": "closed"
      }
   }).promise();
}

function addConnectionId(connectionId) {
   return getAvailableGameSession().then((data) => {
      console.log("Game session data: %j", data);

      if (data && data.Count < 1) {
         // create new game session 
         console.log("No sessions exist, creating session...");

         return ddb.put({
            TableName: TABLE_NAME,
            Item: {
               uuid: Date.now() + '', // dont do this, use a uuid generation library 
               player1: connectionId,
               player2: "empty"
            },
         }).promise();
      } else {
         // add player to existing session as player2
         console.log("Session exists, adding player2 to existing session");

         return ddb.update({
            TableName: TABLE_NAME,
            Key: {
               "uuid": data.Items[0].uuid // just grap the first result, as there should only be one
            },
            UpdateExpression: "set player2 = :p2",
            ExpressionAttributeValues: {
               ":p2": connectionId
            }
         }).promise().then(() => {
            // inform player 1 game started.  Cannot yet send message to player2.
            send(data.Items[0].player1, '{ "uuid": ' + data.Items[0].uuid + ', "opcode": ' + PLAYING_OP +
               ' }');
         });
      }
   });
}

exports.handler = (event, context, callback) => {
   const connectionId = event.requestContext.connectionId;
   console.log("Connect event received: %j", event);
   init(event);

   addConnectionId(connectionId).then(() => {
      callback(null, {
         statusCode: 200
      });
   });
}