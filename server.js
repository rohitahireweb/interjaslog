const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Load environment variables if .env exists
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const idx = trimmed.indexOf('=');
                const key = trimmed.substring(0, idx).trim();
                let val = trimmed.substring(idx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.substring(1, val.length - 1);
                }
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        });
    }
} catch (e) {
    console.warn('Notice: Could not load .env file:', e.message);
}

// Nodemailer optional requirement
let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (e) {
    // Nodemailer will be loaded if installed
}

const PORT = process.env.PORT || 8080;
const BASE_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject'
};

// In-memory rate limiting map: ip -> timestamps[]
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 10;

function isRateLimited(ip) {
    const now = Date.now();
    const timestamps = rateLimitMap.get(ip) || [];
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
        return true;
    }
    recent.push(now);
    rateLimitMap.set(ip, recent);
    return false;
}

// Clean old rate limit entries every hour
setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of rateLimitMap.entries()) {
        const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
        if (recent.length === 0) {
            rateLimitMap.delete(ip);
        } else {
            rateLimitMap.set(ip, recent);
        }
    }
}, 60 * 60 * 1000);

// Basic HTML sanitization
function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .trim();
}

// Email Transporter Factory
let cachedTestAccount = null;

async function getTransporter() {
    if (!nodemailer) return null;
    const host = process.env.EMAIL_HOST;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASSWORD;

    // 1. If real credentials configured in .env
    if (user && pass && user !== 'your-email@gmail.com' && pass !== 'your-app-password') {
        if (host === 'smtp.gmail.com' || user.endsWith('@gmail.com')) {
            return {
                transporter: nodemailer.createTransport({
                    service: 'gmail',
                    auth: { user, pass }
                }),
                isTest: false
            };
        }
        return {
            transporter: nodemailer.createTransport({
                host: host || 'smtp.gmail.com',
                port: parseInt(process.env.EMAIL_PORT, 10) || 587,
                secure: process.env.EMAIL_SECURE === 'true' || process.env.EMAIL_PORT === '465',
                auth: { user, pass },
                tls: { rejectUnauthorized: false }
            }),
            isTest: false
        };
    }

    // 2. Local Fallback: create an Ethereal test account so local testing delivers live viewable emails
    try {
        if (!cachedTestAccount) {
            cachedTestAccount = await nodemailer.createTestAccount();
            console.log('🧪 Initialized Local Ethereal Test Email Account:', cachedTestAccount.user);
        }
        return {
            transporter: nodemailer.createTransport({
                host: cachedTestAccount.smtp.host,
                port: cachedTestAccount.smtp.port,
                secure: cachedTestAccount.smtp.secure,
                auth: {
                    user: cachedTestAccount.user,
                    pass: cachedTestAccount.pass
                }
            }),
            isTest: true
        };
    } catch (testErr) {
        console.warn('Could not create Ethereal test account:', testErr.message);
        return null;
    }
}

// Send Email Notifications
async function handleEmailNotifications(data, clientIp) {
    const adminRecipient = process.env.EMAIL_TO || 'rohitahireweb@gmail.com';
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    console.log('====================================================');
    console.log('📦 NEW REQUEST QUOTE ENQUIRY RECEIVED:');
    console.log('Timestamp:', timestamp, 'IST');
    console.log('Client IP:', clientIp);
    console.log('Name:     ', `${data.firstName} ${data.lastName}`);
    console.log('Company:  ', data.company || '(None)');
    console.log('Email:    ', data.email);
    console.log('Cargo:    ', data.cargoType);
    console.log('Service:  ', data.serviceRequired);
    console.log('Message:  ', data.message);
    console.log('====================================================');

    const mailContext = await getTransporter();
    if (!mailContext || !mailContext.transporter) {
        console.log('ℹ️  No email transporter available. Form submission logged successfully.');
        return { success: true, mode: 'logged' };
    }

    const { transporter, isTest } = mailContext;
    const senderFrom = isTest
        ? `"InterJAS Logistics (Test)" <${cachedTestAccount ? cachedTestAccount.user : 'no-reply@interjaslog.com'}>`
        : (process.env.EMAIL_FROM || `"InterJAS Logistics" <${process.env.EMAIL_USER || 'no-reply@interjaslog.com'}>`);

    try {
        // 1. Admin Email Options
        const adminMailOptions = {
            from: senderFrom,
            to: adminRecipient,
            replyTo: data.email,
            subject: `New Request Quote Enquiry - InterJAS [${data.cargoType} / ${data.serviceRequired}]`,
            text: `New Request Quote Enquiry - InterJAS Logistics\n\n` +
                `Submission Time: ${timestamp} IST\n` +
                `Source: Request Quote Page\n` +
                `Client IP: ${clientIp}\n\n` +
                `----------------------------------------\n` +
                `First Name:       ${data.firstName}\n` +
                `Last Name:        ${data.lastName}\n` +
                `Company:          ${data.company || 'N/A'}\n` +
                `Email Address:    ${data.email}\n` +
                `Cargo Type:       ${data.cargoType}\n` +
                `Service Required: ${data.serviceRequired}\n` +
                `----------------------------------------\n\n` +
                `Message:\n${data.message}\n`,
            html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <div style="background: #0E1B2E; padding: 24px; text-align: center;">
                    <h2 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 0.5px;">New Request Quote Enquiry</h2>
                    <p style="color: #94A3B8; margin: 6px 0 0 0; font-size: 13px;">InterJAS Logistics Online Portal</p>
                </div>
                <div style="padding: 24px;">
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 0; color: #64748b; font-weight: 600; width: 140px;">First Name</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 500;">${sanitize(data.firstName)}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Last Name</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 500;">${sanitize(data.lastName)}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Company</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 500;">${sanitize(data.company) || '<em>N/A</em>'}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Email Address</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 500;"><a href="mailto:${sanitize(data.email)}" style="color: #2563EB; text-decoration: none;">${sanitize(data.email)}</a></td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Cargo Type</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 600; color: #2563EB;">${sanitize(data.cargoType)}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Service Required</td>
                            <td style="padding: 10px 0; color: #0f172a; font-weight: 600;">${sanitize(data.serviceRequired)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px 0; color: #64748b; font-weight: 600; vertical-align: top;">Message</td>
                            <td style="padding: 10px 0; color: #334155; line-height: 1.6; white-space: pre-wrap;">${sanitize(data.message)}</td>
                        </tr>
                    </table>
                    <div style="background: #F8FAFC; border-radius: 6px; padding: 12px 16px; font-size: 12px; color: #64748b;">
                        <strong>Submission Info:</strong> Received on ${timestamp} IST | IP: ${clientIp}
                    </div>
                </div>
            </div>
            `
        };

        // 2. User Confirmation Auto-reply
        const userMailOptions = {
            from: senderFrom,
            to: data.email,
            subject: `We received your Request Quote enquiry - InterJAS Logistics`,
            text: `Hello ${data.firstName},\n\n` +
                `Thank you for contacting InterJAS Logistics.\n\n` +
                `We have received your Request Quote enquiry and one of our logistics specialists will review your shipment details and respond with a tailored solution shortly.\n\n` +
                `Your Enquiry Details:\n` +
                `- Cargo Type: ${data.cargoType}\n` +
                `- Service Required: ${data.serviceRequired}\n\n` +
                `If you need immediate assistance, please feel free to reach our desk:\n` +
                `Phone: +91 85549 82611 / +91 22 4322 1000\n` +
                `Email: sales@interjaslog.com / info@interjaslog.com\n\n` +
                `Regards,\n` +
                `InterJAS Logistics Team\n` +
                `https://interjaslog.com\n`,
            html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <div style="background: #0E1B2E; padding: 24px; text-align: center;">
                    <h2 style="color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 0.5px;">InterJAS Logistics</h2>
                    <p style="color: #94A3B8; margin: 6px 0 0 0; font-size: 13px;">Quote Enquiry Confirmation</p>
                </div>
                <div style="padding: 28px 24px; color: #1e293b; font-size: 14px; line-height: 1.6;">
                    <p style="margin-top: 0; font-size: 16px;">Hello <strong>${sanitize(data.firstName)}</strong>,</p>
                    <p>Thank you for contacting <strong>InterJAS Logistics</strong>.</p>
                    <p>We have successfully received your Request Quote enquiry. Our specialists are reviewing your requirements and will respond with a tailored freight solution shortly.</p>
                    
                    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 16px; margin: 20px 0;">
                        <h4 style="margin: 0 0 10px 0; color: #0E1B2E; font-size: 14px;">Your Shipment Details:</h4>
                        <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Cargo Type:</strong> ${sanitize(data.cargoType)}</p>
                        <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Service Required:</strong> ${sanitize(data.serviceRequired)}</p>
                    </div>

                    <p style="margin-bottom: 4px;">Need urgent assistance? Reach our desk directly:</p>
                    <ul style="margin: 4px 0 20px 0; padding-left: 20px; color: #475569; font-size: 13px;">
                        <li>Phone: <strong>+91 85549 82611</strong> / <strong>+91 22 4322 1000</strong></li>
                        <li>Email: <a href="mailto:sales@interjaslog.com" style="color: #2563EB;">sales@interjaslog.com</a></li>
                    </ul>

                    <p style="margin-bottom: 0;">Warm regards,<br><strong>InterJAS Logistics Team</strong><br><a href="https://interjaslog.com" style="color: #2563EB; font-size: 12px;">interjaslog.com</a></p>
                </div>
            </div>
            `
        };

        const [infoAdmin, infoUser] = await Promise.all([
            transporter.sendMail(adminMailOptions),
            transporter.sendMail(userMailOptions)
        ]);

        if (isTest) {
            console.log('----------------------------------------------------');
            console.log('📧 [LOCAL TEST MODE] Emails Generated Successfully!');
            console.log('🔗 Admin Email Preview:     ', nodemailer.getTestMessageUrl(infoAdmin));
            console.log('🔗 User Auto-reply Preview: ', nodemailer.getTestMessageUrl(infoUser));
            console.log('----------------------------------------------------');
        } else {
            console.log('✅ Real emails dispatched via SMTP to:', adminRecipient, 'and', data.email);
        }

        return { success: true, mode: isTest ? 'test_preview' : 'smtp' };
    } catch (mailErr) {
        console.error('⚠️  Failed to dispatch email via SMTP:', mailErr.message);
        return { success: true, mode: 'fallback_logged' };
    }
}

// Request Handler
const server = http.createServer((req, res) => {
    // Enable Keep-Alive connection
    res.setHeader('Connection', 'keep-alive');

    // Parse URL path and strip query strings / hash
    const rawUrl = req.url || '/';
    let parsedUrl = rawUrl.split('?')[0].split('#')[0];

    // =========================================================================
    // API: POST /api/request-quote
    // =========================================================================
    if (parsedUrl === '/api/request-quote' && req.method === 'POST') {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

        // Check rate limiting
        if (isRateLimited(clientIp)) {
            res.writeHead(429, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({
                success: false,
                message: 'Too many requests. Please wait a few minutes before trying again.'
            }));
            return;
        }

        let body = '';
        let bodyLength = 0;
        const MAX_BODY_SIZE = 100 * 1024; // 100KB max

        req.on('data', chunk => {
            body += chunk;
            bodyLength += chunk.length;
            if (bodyLength > MAX_BODY_SIZE) {
                res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: 'Payload too large.' }));
                req.destroy();
            }
        });

        req.on('end', async () => {
            try {
                let data = {};
                try {
                    data = JSON.parse(body);
                } catch (jsonErr) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, message: 'Invalid JSON format.' }));
                    return;
                }

                // Honeypot check (_gotcha / website field)
                if (data._gotcha || data.website_hp) {
                    console.log('🤖 Bot submission intercepted by honeypot.');
                    // Return fake success to confuse bots
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, message: 'Thank you! Your enquiry has been received.' }));
                    return;
                }

                const firstName = (data.firstName || '').trim();
                const lastName = (data.lastName || '').trim();
                const company = (data.company || '').trim();
                const email = (data.email || '').trim();
                const cargoType = (data.cargoType || '').trim();
                const serviceRequired = (data.serviceRequired || '').trim();
                const message = (data.message || '').trim();

                // Server-side validation
                const errors = [];
                if (!firstName) errors.push('First Name is required.');
                if (!lastName) errors.push('Last Name is required.');
                if (!email) {
                    errors.push('Email Address is required.');
                } else {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(email)) {
                        errors.push('Please provide a valid email address.');
                    }
                }
                if (!cargoType) errors.push('Please select a Cargo Type.');
                if (!serviceRequired) errors.push('Please select a Service Required.');
                if (!message) {
                    errors.push('Message is required.');
                } else if (message.length < 5) {
                    errors.push('Message must be at least 5 characters long.');
                }

                if (errors.length > 0) {
                    res.writeHead(422, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify({ success: false, message: errors[0], errors }));
                    return;
                }

                // Dispatch emails
                await handleEmailNotifications({
                    firstName,
                    lastName,
                    company,
                    email,
                    cargoType,
                    serviceRequired,
                    message
                }, clientIp);

                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({
                    success: true,
                    message: 'Thank you! Your enquiry has been submitted successfully. Our team will get back to you shortly.'
                }));

            } catch (err) {
                console.error('Server error handling request-quote:', err);
                res.writeHead(500, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({
                    success: false,
                    message: 'We couldn\'t submit your enquiry right now. Please try again or contact us directly.'
                }));
            }
        });
        return;
    }

    // Handle OPTIONS preflight for CORS if needed
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
    }

    // =========================================================================
    // Static Files Serving
    // =========================================================================
    if (parsedUrl === '/') {
        parsedUrl = '/index.html';
    }

    const safePath = path.normalize(decodeURIComponent(parsedUrl)).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(BASE_DIR, safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const etag = `W/"${stats.size}-${stats.mtimeMs.toString(16)}"`;

        // Check conditional headers (304 Not Modified)
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag) {
            res.writeHead(304, {
                'ETag': etag,
                'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400, stale-while-revalidate=3600',
                'Access-Control-Allow-Origin': '*'
            });
            res.end();
            return;
        }

        const isHtml = ext === '.html';
        const headers = {
            'Content-Type': contentType,
            'ETag': etag,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': isHtml
                ? 'public, max-age=0, must-revalidate'
                : 'public, max-age=31536000, immutable'
        };

        // Determine compression support for compressible types
        const isCompressible = /\.(html|css|js|json|svg)$/i.test(filePath);
        const acceptEncoding = req.headers['accept-encoding'] || '';

        let readStream = fs.createReadStream(filePath);

        if (isCompressible && acceptEncoding.includes('gzip')) {
            headers['Content-Encoding'] = 'gzip';
            res.writeHead(200, headers);
            readStream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
        } else if (isCompressible && acceptEncoding.includes('deflate')) {
            headers['Content-Encoding'] = 'deflate';
            res.writeHead(200, headers);
            readStream.pipe(zlib.createDeflate()).pipe(res);
        } else {
            headers['Content-Length'] = stats.size;
            res.writeHead(200, headers);
            readStream.pipe(res);
        }

        readStream.on('error', (streamErr) => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            }
            res.end('500 Internal Server Error');
        });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`High-speed server with Gzip, Caching, and API running at http://localhost:${PORT}/`);
});
