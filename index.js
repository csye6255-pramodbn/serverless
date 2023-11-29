const fs = require('fs');
const axios = require('axios');
const { Storage } = require('@google-cloud/storage');
const JSZip = require("jszip");
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const counts = {};

// Function to generate a unique local and destination blob name using a counter
function generateFileNames(name) {
    if (!counts[name]) {
        counts[name] = 1; // Initialize counter for new name
    }
    let counter = counts[name]; // Get current counter for name
    let uniqueFileName = `${name}_${counter}.zip`;
    counts[name]++; // Increment counter for the name
    return {
        localPath: `/tmp/${uniqueFileName}`,
        destinationBlobName: `${name}/${uniqueFileName}`
    };
}

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


async function isZipEmpty(zipPath) {
    const data = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(data);
    const fileNames = Object.keys(zip.files);

    for (let fileName of fileNames) {
        const fileData = await zip.files[fileName].async("nodebuffer");
        if (fileData.length > 0) {
            return false; // Found a file that is not empty
        }
    }

    return true; // All files in the zip are empty, or the zip itself is empty
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
    const { localPath, destinationBlobName } = generateFileNames(name);
    
    try {
        const downloadSuccess = await downloadFile(url, localPath);
        const stats = fs.statSync(localPath);
        console.log("file size",stats.size);
        console.log("download status",downloadSuccess);
        if (downloadSuccess) {
            console.log("inside block");
            const isZipContentEmpty = await isZipEmpty(localPath);
            console.log("isZipEmtpy",isZipContentEmpty);
            if (isZipContentEmpty==false){
                console.log("Files not zero bytes");
                await uploadToGCP(bucketName, localPath, destinationBlobName, credentials);
                const emailSubject = "Assignment Download and Upload Successful";
                const emailBody = `Hello ${name},\n\nThe Assignment has been successfully downloaded and uploaded to GCP Bucket.\nYour submission path in GCS is gs://${bucketName}/${destinationBlobName}\n\nBest Regards,\nPramod Cloud`;
                await sendEmail(sesClient, recipient, emailSubject, emailBody);
                await logEmailEvent(dynamoDB, tableName, name, recipient, "Success", "File downloaded and uploaded successfully");
            } else if (isZipContentEmpty==true){
                console.log("Files zero bytes");
                throw new Error("Empty File");
            }
          

        }
    // If there is an error in downloading the file, send an email to the user to resubmit, and log the failure event in DynamoDB
    } catch (error) {
        console.error(`Error in processing: ${error}`);
        let emailSubject, emailBody;
        if (error.message === "Empty File") {
            emailSubject = 'Assignment Downloaded is Empty';
            emailBody = `Hello ${name},\n\nYour assignment file appears to be empty. Please check and resubmit a valid file.\n\nBest Regards,\nPramod Cloud`;
        } else {
            emailSubject = "Assignment Download Failed";
            emailBody = `Hello ${name},\n\nThere was an error downloading your assignment, because of invalid link, please resubmit it.\n\nBest Regards,\nPramod Cloud`;
        }
        await sendEmail(sesClient, recipient, emailSubject, emailBody);
        await logEmailEvent(dynamoDB, tableName, name, recipient, "Failure", error.message);
    }

    return {
        statusCode: 200,
        body: "success"
    };
}

module.exports = { lambdaHandler };