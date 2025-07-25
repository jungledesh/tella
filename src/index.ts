// Import Express and types for server framework.
import express from 'express';
import { Request, Response } from 'express';

// Create Express app instance.
const app = express();

// Set server port.
const port = 3000;

// Middleware to parse URL-encoded bodies (e.g., Twilio POST).
app.use(express.urlencoded({ extended: true }));

// GET route for root to test server.
app.get('/', (req: Request, res: Response) => {
  res.send('Tella server is running!');
});

// POST route for SMS webhook stub.
app.post('/sms', (req: Request, res: Response) => {
  const from = req.body.From || 'unknown'; // Extract sender phone.
  const body = req.body.Body || ''; // Extract message body.
  console.log(`Received SMS from ${from}: ${body}`); // Log for debugging.
  res.status(200).send('<Response></Response>'); // Return TwiML for Twilio.
});

// Start server on port.
app.listen(port, () => {
  console.log(`Tella server running on http://localhost:${port}`);
});
