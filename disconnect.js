const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();
require('./patch-disconnect.js');
const TABLE_NAME = "game-session";
let dissconnectWs = undefined;
let wsStatus = undefined;

function init(event) {
    console.log(event)
    const apigwManagementApi = new AWS.ApiGatewayManagementApi({ apiVersion: '2018-11-29', endpoint: event.requestContext.domainName + '/' + event.requestContext.stage });
    dissconnectWs = async(connectionId) => {
        await apigwManagementApi.deleteConnection({ ConnectionId: connectionId }).promise();
    }
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

async function closeGame(uuid) {
    ddb.update({
        TableName: TABLE_NAME,
        Key: {
            "uuid": uuid
        },
        UpdateExpression: "set gameStatus = :status",
        ExpressionAttributeValues: {
            ":status": "closed"
        }
    }).promise();
}

exports.handler = (event, context, callback) => {
    console.log("Disconnect event received: %j", event);
    init(event);

    const connectionIdForCurrentRequest = event.requestContext.connectionId;
    console.log("Request from player: " + connectionIdForCurrentRequest);

    getGameSession(connectionIdForCurrentRequest).then((data) => {
        console.log("getGameSession: " + data.Items[0].uuid);

        if (data.Items[0].player1 == connectionIdForCurrentRequest) {
            
            closeGame(data.Items[0].uuid);
            
            // player1 disconnected, now disconnect player 2
            if (data.Items[0].player2 !== 'empty') {
                console.log("Disconnecting player 2: " + data.Items[0].player2);
                
                dissconnectWs(data.Items[0].player2).then(() => {}, (err) => {
                    console.log("Error closing connection, player 2 probably already closed.");
                    console.log(err);
                });
            }
            else {
                console.log("Player2 was never filled")
            }
        }
        else {
            // player2 disconnected, now disconnect player 1
            console.log("Disconnecting player 1: " + data.Items[0].player1);
            
            closeGame(data.Items[0].uuid);
            
            dissconnectWs(data.Items[0].player1).then(() => {}, (err) => {
                console.log("Error closing connection, player 1 probably already closed.");
                console.log(err);
            });;
        }
    });

    return callback(null, { statusCode: 200, });
}
