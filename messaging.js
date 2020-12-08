const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
require('./patch.js');
let send = undefined;
const TABLE_NAME = "game-session-1";
const FIRST_TO_JOIN_OP = "0";
const REQUEST_START_OP = "1";
const THROW_OP = "5";
const BLOCK_HIT_OP = "9";
const YOU_WON = "91";
const YOU_LOST = "92";
const PLAYING_OP = "11";
const OPPONENT_LOC = "20";

function init(event) {
   const apigwManagementApi = new AWS.ApiGatewayManagementApi({
      apiVersion: '2018-11-29',
      endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
   });
   send = async(connectionId, data) => {
      await apigwManagementApi.postToConnection({
         ConnectionId: connectionId,
         Data: `${data}`
      }).promise();
   }
}

// TODO: is this used?
function getConnections() {
   return ddb.scan({
      TableName: TABLE_NAME,
   }).promise();
}

function getGameSession(playerId) {
   return ddb.scan({
      TableName: TABLE_NAME,
      FilterExpression: "#p1 = :playerId or #p2 = :playerId",
      ExpressionAttributeNames: {
         "#p1": "player1",
         "#p2": "player2"
      },
      ExpressionAttributeValues: {
         ":playerId": playerId
      }
   }).promise();
}

function getGameSessionByMatchUuid(uuid) {
   return ddb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#uuid = :uuid",
      ExpressionAttributeNames: {
         "#uuid": "uuid"
      },
      ExpressionAttributeValues: {
         ":uuid": uuid
      }
   }).promise();
}

exports.handler = (event, context, callback) => {
   console.log("Event received: %j", event);
   init(event);

   let message = JSON.parse(event.body);
   console.log("message: %j", message);

   let connectionIdForCurrentRequest = event.requestContext.connectionId;
   console.log("Current connection id: " + connectionIdForCurrentRequest);

   if (message && message.opcode) {

      switch (message.opcode) {
         case REQUEST_START_OP:
            console.log("opcode 1 hit");

            getGameSession(connectionIdForCurrentRequest).then((data) => {
               console.log("getGameSession: " + data.Items[0].uuid);

               // we check for closed to handle an edge case where if player1 joins and immediately quits,
               // we mark closed to make sure a player2 can't join an abandoned game session
               var opcodeStart = FIRST_TO_JOIN_OP;
               if (data.Items[0].gameStatus != "closed" && data.Items[0].player2 != "empty") {
                  opcodeStart = PLAYING_OP;

                  //now that we have a 2nd player, also send PlayingOp status to kick off player 1
                  send(data.Items[0].player1, '{ "uuid": ' + data.Items[0].uuid + ', "opcode": ' +
                     opcodeStart + ' }');

                  send(connectionIdForCurrentRequest, '{ "uuid": ' + data.Items[0].uuid + ', "opcode": ' +
                     opcodeStart + ' }');
               }
            });

            break;

         case THROW_OP:
            console.log("opcode 5 hit");

            getGameSession(connectionIdForCurrentRequest).then((data) => {
               console.log("getGameSession: %j", data.Items[0]);

               var sendToConnectionId = connectionIdForCurrentRequest;
               if (data.Items[0].player1 == connectionIdForCurrentRequest) {
                  // request came from player1, just send out to player2
                  sendToConnectionId = data.Items[0].player2;
               }
               else {
                  // request came from player2, just send out to player1
                  sendToConnectionId = data.Items[0].player1;
               }

               console.log("sending throw message to: " + sendToConnectionId);
               send(sendToConnectionId, '{ "uuid": ' + data.Items[0].uuid + ', "opcode": ' +
                  THROW_OP + ', "message": "other player threw ball" }');
            });

            break;

         case OPPONENT_LOC:
            console.log("opcode 20 opponent loc");
            console.log(message.position);
            console.log(message.uuid);

            getGameSessionByMatchUuid(message.uuid).then((data) => {   
               console.log("getGameSession: %j", data.Items[0]);

               console.log("current connection: %j", connectionIdForCurrentRequest);
               console.log("Player1: %j", data.Items[0].player1);
               console.log("Player2: %j", data.Items[0].player2);

               if (data.Items[0].player1 == connectionIdForCurrentRequest) {

                  console.log("current connection: %j", connectionIdForCurrentRequest);

                  if (data.Items[0].player2 != "empty") {
                     console.log("Sending postion to player 2: ");
                     console.log(message.position);
                     let posMsg = '{ "opcode": ' + OPPONENT_LOC + ', "timestamp": ' + Date.now() + ', "position": { "x": ' + message.position.x + ', "y": ' + message.position.y + ', "z": ' + message.position.z + '} }';
                     console.log(posMsg);

                     // player1 sent location, send loc to player2
                     send(data.Items[0].player2, posMsg);

                     //TODO: remove: send(data.Items[0].player1, posMsg); // Testing only, send to player that sent out post request
                  }

               }
               else {
                  console.log("Sending postion to player 1: ");
                  console.log(message.position);
                  let posMsg = '{ "opcode": ' + OPPONENT_LOC + ', "timestamp": ' + Date.now() + ', "position": { "x": ' + message.position.x + ', "y": ' + message.position.y + ', "z": ' + message.position.z + '} }';
                  console.log(posMsg);

                  // player2 sent location, send loc to player 1
                  send(data.Items[0].player1, posMsg);
               }
            });

            break;

         case BLOCK_HIT_OP: // block hit, send game over
            console.log("opcode 9 hit");

            getGameSession(connectionIdForCurrentRequest).then((data) => {
               console.log("getGameSession: %j", data.Items[0]);

               if (data.Items[0].player1 == connectionIdForCurrentRequest) {
                  // player1 was the winner
                  send(data.Items[0].player1, '{ "opcode": ' + YOU_WON + ' }');
                  send(data.Items[0].player2, '{ "opcode": ' + YOU_LOST + ' }');
               }
               else {
                  // player2 was the winner
                  send(data.Items[0].player1, '{ "opcode": ' + YOU_LOST + ' }');
                  send(data.Items[0].player2, '{ "opcode": ' + YOU_WON + ' }');
               }
            });

         default:
            // no default case
      }
   }

   return callback(null, {
      statusCode: 200,
   });
};
