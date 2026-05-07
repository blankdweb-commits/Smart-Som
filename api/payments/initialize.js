// api/payments/initialize.js
import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, amount, metadata, callback_url } = req.body;

  if (!email || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: Math.round(amount * 100), // Convert to kobo
        metadata,
        callback_url: callback_url || `${process.env.APP_URL}/payments/verify`
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.status(200).json(response.data);
  } catch (error) {
    console.error('Paystack initialization error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to initialize payment' });
  }
}
