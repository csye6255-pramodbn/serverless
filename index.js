const fs = require('fs');
const axios = require('axios');
const { Storage } = require('@google-cloud/storage');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

// Function to Download file from URL
async function downloadFile(url, localPath) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
    });

    return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(localPath);
        response.data.pipe(fileStream);
        fileStream.on('finish', () => resolve(true));
        fileStream.on('error', (error) => reject(error));
    });
}

// Function to Upload file to GCP Bucket
async function uploadToGCP(bucketName, sourceFilePath, destinationBlobName, credentials) {
    const storage = new Storage({
        credentials: credentials,
        projectId: credentials.project_id,
    });

    const bucket = storage.bucket(bucketName);
    await bucket.upload(sourceFilePath, {
        destination: destinationBlobName,
    });
}

// Function to Send Email using AWS SES
async function sendEmail(sesClient, recipient, subject, body) {
    const sender = "Pramod Cloud <no-reply@pramod.cloud>";
    try {
        await sesClient.sendEmail({
            Source: sender,
            Destination: { ToAddresses: [recipient] },
            Message: {
                Subject: { Data: subject },
                Body: { Text: { Data: body } }
            }
        }).promise();
        return true;
    } catch (error) {
        console.error(`Error sending email: ${error}`);
        return false;
    }
}

// Function to Log Email Event in DynamoDB
async function logEmailEvent(dynamoDB, tableName, name, email, eventType, details) {
    const timestamp = new Date().toISOString();
    const eventId = uuidv4();

    const params = {
        TableName: tableName,
        Item: {
            ID: eventId,
            Name: name,
            Email: email,
            Timestamp: timestamp,
            Status: eventType,
            StatusDetails: details
        }
    };

    await dynamoDB.put(params).promise();
}

// Lambda Handler (Main Function) - Entry Point
async function lambdaHandler(event, context) {
    let sesClient = new AWS.SES(); // SES Client
    let dynamoDB = new AWS.DynamoDB.DocumentClient(); // DynamoDB Client

    let tableName = process.env.DYNAMODB_TABLE_NAME; // Taking DynamoDB Table Name from Lambda's Environment Variables
    if (!tableName) {
        throw new Error("DynamoDB table name not set in environment variables");
    }

    // Parse the SNS message
    let message = JSON.parse(event.Records[0].Sns.Message);
    let name = message.name;
    let url = message.url;
    const recipient = message.email;

    let bucketName = process.env.GCP_BUCKET_NAME; // Taking GCP Bucket Name from Lambda's Environment Variables
    let gcpCredentialsBase64 = process.env.GCP_CREDENTIALS; // Taking GCP Credentials from Lambda's Environment Variables

    if (!bucketName || !gcpCredentialsBase64 || !name || !url) {
        throw new Error("Missing required data");
    }

    // Decode GCP Credentials
    const gcpCredentialsJson = Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8');
    const credentials = JSON.parse(gcpCredentialsJson);

    let uniqueId = uuidv4(); // Generate a unique ID for the file
    let localPath = `/tmp/${name}_${uniqueId}.zip`; // Local Path to store the downloaded file /tmp in Lambda
    let destinationBlobName = `${name}_${uniqueId}.zip`; // Destination Blob Name in GCP Bucket

    // Download the file from URL and upload it to GCP Bucket, then send a success email to the user, and log the success event in DynamoDB
    try {
        const downloadSuccess = await downloadFile(url, localPath);
        if (downloadSuccess) {
            await uploadToGCP(bucketName, localPath, destinationBlobName, credentials);
            const emailSubject = "Assignment Download and Upload Successful";
            const emailBody = `Hello ${name},\n\nThe Assignment has been successfully downloaded and uploaded to GCP Bucket.\n\nBest Regards,\nPramod Cloud`;
            await sendEmail(sesClient, recipient, emailSubject, emailBody);
            await logEmailEvent(dynamoDB, tableName, name, recipient, "Success", "File downloaded and uploaded successfully");
        }
    // If there is an error in downloading the file, send an email to the user to resubmit, and log the failure event in DynamoDB
    } catch (error) {
        console.error(`Error in processing: ${error}`);
        const emailSubject = "Assignment Download Failed";
        const emailBody = `Hello ${name},\n\nThere was an error downloading your assignment, please resubmit it.\n\nBest Regards,\nPramod Cloud`;
        await sendEmail(sesClient, recipient, emailSubject, emailBody);
        await logEmailEvent(dynamoDB, tableName, name, recipient, "Failure", "Error in downloading the file");
    }

    return {
        statusCode: 200,
        body: "success"
    };
}

module.exports = { lambdaHandler };