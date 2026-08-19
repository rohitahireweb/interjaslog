<?php
/**
 * InterJAS Logistics - Request a Quote PHP Mailer
 * 
 * Features:
 * - Sanitizes and validates all incoming form fields
 * - Anti-spam honeypot protection
 * - Sends comprehensive HTML email notification to Admin (rohitahireweb@gmail.com)
 * - Sends branded HTML Auto-Reply confirmation email to the Customer
 * - Returns clean JSON response for AJAX requests with standard HTTP status codes
 */

// Set response headers for JSON AJAX requests
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Ensure request method is POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method Not Allowed. Please submit the form via POST.'
    ]);
    exit;
}

// -----------------------------------------------------------------------------
// 1. Extract & Parse Input Data (supports both JSON body & standard Form POST)
// -----------------------------------------------------------------------------
$rawInput = file_get_contents('php://input');
$jsonData = json_decode($rawInput, true);

if (is_array($jsonData)) {
    $input = $jsonData;
} else {
    $input = $_POST;
}

// Helper function to safely sanitize string inputs
function cleanInput($data) {
    if (is_null($data)) return '';
    $data = trim($data);
    $data = stripslashes($data);
    return htmlspecialchars($data, ENT_QUOTES, 'UTF-8');
}

// Extract fields
$firstName       = cleanInput($input['firstName'] ?? '');
$lastName        = cleanInput($input['lastName'] ?? '');
$company         = cleanInput($input['company'] ?? '');
$email           = filter_var(trim($input['email'] ?? ''), FILTER_SANITIZE_EMAIL);
$cargoType       = cleanInput($input['cargoType'] ?? '');
$serviceRequired = cleanInput($input['serviceRequired'] ?? '');
$message         = cleanInput($input['message'] ?? '');
$gotcha          = cleanInput($input['_gotcha'] ?? '');
$botcheck        = cleanInput($input['botcheck'] ?? '');

// -----------------------------------------------------------------------------
// 2. Anti-Spam Honeypot Verification
// -----------------------------------------------------------------------------
if (!empty($gotcha) || !empty($botcheck)) {
    // Silently return success to fool bots without sending emails
    echo json_encode([
        'success' => true,
        'message' => 'Thank you! Your enquiry has been submitted successfully.'
    ]);
    exit;
}

// -----------------------------------------------------------------------------
// 3. Server-Side Validation
// -----------------------------------------------------------------------------
$errors = [];

if (empty($firstName)) {
    $errors[] = 'First name is required.';
}
if (empty($lastName)) {
    $errors[] = 'Last name is required.';
}
if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $errors[] = 'A valid email address is required.';
}
if (empty($cargoType)) {
    $errors[] = 'Please select a Cargo Type.';
}
if (empty($serviceRequired)) {
    $errors[] = 'Please select a Service Required.';
}
if (empty($message) || mb_strlen($message) < 5) {
    $errors[] = 'Message must be at least 5 characters long.';
}

if (!empty($errors)) {
    http_response_code(422);
    echo json_encode([
        'success' => false,
        'message' => $errors[0],
        'errors'  => $errors
    ]);
    exit;
}

// -----------------------------------------------------------------------------
// 4. Configuration & Email Settings
// -----------------------------------------------------------------------------
$adminEmail     = 'rohitahireweb@gmail.com'; // Primary Admin Recipient
$senderEmail    = 'info@interjaslog.com';     // Sender address (or website domain email)
$senderName     = 'InterJAS Logistics';
$fullName       = $firstName . ' ' . $lastName;
$clientIp       = $_SERVER['REMOTE_ADDR'] ?? 'Unknown IP';
date_default_timezone_set('Asia/Kolkata');
$currentDateTime = date('d M Y, h:i A') . ' IST';

// -----------------------------------------------------------------------------
// 5. Build Admin Notification Email
// -----------------------------------------------------------------------------
$adminSubject = "New Quote Enquiry: {$fullName} [{$cargoType} / {$serviceRequired}]";

$adminHtmlBody = <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>New Request Quote Enquiry</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        
        <!-- Header -->
        <div style="background-color: #0E1B2E; padding: 28px 24px; text-align: center;">
            <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: 0.5px;">InterJAS Logistics</h1>
            <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 13px;">New Request a Quote Submission</p>
        </div>

        <!-- Body Content -->
        <div style="padding: 28px 24px;">
            <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 16px; margin-bottom: 24px; border-radius: 4px;">
                <p style="margin: 0; color: #1e40af; font-size: 14px; font-weight: 600;">
                    You have received a new quotation enquiry from the website.
                </p>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 0; color: #64748b; font-weight: 600; width: 140px;">Customer Name:</td>
                    <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">{$fullName}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Company:</td>
                    <td style="padding: 10px 0; color: #0f172a;">{$company}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Email Address:</td>
                    <td style="padding: 10px 0; color: #2563eb;"><a href="mailto:{$email}" style="color: #2563eb; text-decoration: none;">{$email}</a></td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Cargo Type:</td>
                    <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">{$cargoType}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Service Required:</td>
                    <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">{$serviceRequired}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Submission Time:</td>
                    <td style="padding: 10px 0; color: #64748b;">{$currentDateTime}</td>
                </tr>
            </table>

            <div style="margin-top: 16px;">
                <p style="margin: 0 0 8px 0; color: #64748b; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Customer Message / Shipment Details:</p>
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 6px; font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-wrap;">{$message}</div>
            </div>

            <!-- Quick Action Reply Button -->
            <div style="margin-top: 28px; text-align: center;">
                <a href="mailto:{$email}?subject=Re: Your Quote Enquiry - InterJAS Logistics" style="display: inline-block; background-color: #0E1B2E; color: #ffffff; text-decoration: none; padding: 12px 28px; font-size: 14px; font-weight: 600; border-radius: 6px;">Reply to Customer</a>
            </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; text-align: center; font-size: 12px; color: #94a3b8;">
            InterJAS Logistics Portal &bull; Client IP: {$clientIp}
        </div>
    </div>
</body>
</html>
HTML;

// -----------------------------------------------------------------------------
// 6. Build Auto-Reply Confirmation Email (Sent to Customer)
// -----------------------------------------------------------------------------
$autoReplySubject = "Quotation Request Received — InterJAS Logistics";

$autoReplyHtmlBody = <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Thank You for Contacting InterJAS Logistics</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        
        <!-- Header -->
        <div style="background-color: #0E1B2E; padding: 28px 24px; text-align: center;">
            <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: 0.5px;">InterJAS Logistics</h1>
            <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 13px;">Global Logistics & Freight Solutions Partner</p>
        </div>

        <!-- Body Content -->
        <div style="padding: 32px 24px;">
            <h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 18px; font-weight: 600;">Dear {$firstName},</h2>
            <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Thank you for requesting a quotation with <strong>InterJAS Logistics</strong>. We have successfully received your enquiry regarding <strong>{$serviceRequired}</strong> ({$cargoType}).
            </p>
            <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Our logistics pricing and operations team is currently reviewing your shipment requirements. One of our dedicated freight specialists will contact you shortly with a customized quote and optimal route plan.
            </p>

            <!-- Summary Box -->
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px;">
                <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #0f172a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Your Enquiry Summary:</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
                    <tr>
                        <td style="padding: 4px 0; color: #64748b; width: 140px;">Service:</td>
                        <td style="padding: 4px 0; color: #0f172a; font-weight: 600;">{$serviceRequired}</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 0; color: #64748b;">Cargo Type:</td>
                        <td style="padding: 4px 0; color: #0f172a; font-weight: 600;">{$cargoType}</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 0; color: #64748b;">Reference Date:</td>
                        <td style="padding: 4px 0; color: #0f172a;">{$currentDateTime}</td>
                    </tr>
                </table>
            </div>

            <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                If your requirement is urgent, please feel free to reach our direct desk:
            </p>
            <p style="margin: 0; font-size: 14px; color: #0f172a; font-weight: 600;">
                📞 Phone: <a href="tel:+912243221000" style="color: #2563eb; text-decoration: none;">+91 22 4322 1000</a><br>
                ✉️ Email: <a href="mailto:info@interjaslog.com" style="color: #2563eb; text-decoration: none;">info@interjaslog.com</a>
            </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
            &copy; 2026 InterJAS Logistics. All rights reserved.<br>
            Office No. 105, 1st Floor, Monarch Plaza, Sector-11, C.B.D Belapur, Navi Mumbai — 400 614
        </div>
    </div>
</body>
</html>
HTML;

// -----------------------------------------------------------------------------
// 7. Dispatch Emails using PHP mail() with proper MIME headers
// -----------------------------------------------------------------------------

// Admin Email Headers
$adminHeaders = [
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'From: ' . "=?UTF-8?B?" . base64_encode($senderName) . "?=" . " <{$senderEmail}>",
    'Reply-To: ' . "=?UTF-8?B?" . base64_encode($fullName) . "?=" . " <{$email}>",
    'X-Mailer: PHP/' . phpversion()
];

// Customer Auto-Reply Email Headers
$autoReplyHeaders = [
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'From: ' . "=?UTF-8?B?" . base64_encode($senderName) . "?=" . " <{$senderEmail}>",
    'Reply-To: ' . "=?UTF-8?B?" . base64_encode($senderName) . "?=" . " <{$senderEmail}>",
    'X-Mailer: PHP/' . phpversion()
];

// Send Admin Email
$adminMailSent = @mail(
    $adminEmail,
    "=?UTF-8?B?" . base64_encode($adminSubject) . "?=",
    $adminHtmlBody,
    implode("\r\n", $adminHeaders)
);

// Send Auto-Reply Confirmation Email to Customer
$autoReplyMailSent = @mail(
    $email,
    "=?UTF-8?B?" . base64_encode($autoReplySubject) . "?=",
    $autoReplyHtmlBody,
    implode("\r\n", $autoReplyHeaders)
);

// Log enquiry to local log file as reliable backup
$logEntry = sprintf(
    "[%s] IP: %s | Name: %s | Email: %s | Service: %s | Cargo: %s | AdminMail: %s | AutoReply: %s\n",
    date('Y-m-d H:i:s'),
    $clientIp,
    $fullName,
    $email,
    $serviceRequired,
    $cargoType,
    $adminMailSent ? 'SENT' : 'FAILED',
    $autoReplyMailSent ? 'SENT' : 'FAILED'
);
@file_put_contents(__DIR__ . '/quote_enquiries.log', $logEntry, FILE_APPEND | LOCK_EX);

// -----------------------------------------------------------------------------
// 8. Return JSON Response
// -----------------------------------------------------------------------------
echo json_encode([
    'success' => true,
    'message' => 'Thank you! Your quote enquiry has been submitted successfully. A confirmation email has also been sent to your inbox.',
    'adminMailSent' => $adminMailSent,
    'autoReplySent' => $autoReplyMailSent
]);
exit;
