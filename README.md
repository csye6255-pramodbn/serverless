## Name: PRAMOD BEGUR NAGARAJ
## NUID: 002708842

## Lambda Function Actions

The Lambda function is designed to perform three key actions, leveraging data received from SNS messages and utilizing environment variables for seamless integration with other services.

### Action 1: File Handling
- **Downloads**: The function downloads a file from a provided URL.
- **Uploads**: After downloading, it uploads the file to the specified GCP Bucket.

### Action 2: Email Notification
- Utilizes AWS Simple Email Service (SES) to send an email to the user.
- **Email Content**: Notifies the user about the status of their file download.

### Action 3: Tracking in DynamoDB
- Tracks the status and details of emails sent in the specified DynamoDB table.

## Data Utilization

### SNS Message Content
The Lambda function receives the following user-related information from the SNS message:
- **User's First Name**
- **User's Email ID**
- **User's Submission URL**

### Environment Variables
The function uses these environment variables for its operations:
- `GCP_CREDENTIALS`: GCP private access key for accessing the GCP Bucket.
- `GCP_BUCKET_NAME`: The name of the GCP Bucket where files are stored.
- `DYNAMODB_TABLE_NAME`: The name of the DynamoDB table used for tracking email statuses.

---

This configuration ensures that the Lambda function can perform its tasks efficiently, making use of both AWS and GCP services to handle files, notify users, and keep track of actions in a database.
