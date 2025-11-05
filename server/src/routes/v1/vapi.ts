import { Router } from 'express';

import { handleVapiEvent, verifyVapiSignature } from '../../services/vapi-service.js';

export const vapiRouter = Router();

vapiRouter.post('/events', async (req, res) => {
  const rawBody = (req as typeof req & { rawBody?: string }).rawBody;

  if (!rawBody) {
    return res.status(400).json({
      message: 'Raw body is required for signature verification',
      code: 'INVALID_PAYLOAD'
    });
  }

  verifyVapiSignature(rawBody, req.header('x-vapi-signature'));

  await handleVapiEvent(req.body);

  res.status(200).json({ received: true });
});
