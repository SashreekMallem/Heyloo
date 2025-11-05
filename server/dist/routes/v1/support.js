import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { setTenantContext } from '../../middleware/tenant-context.js';
import { createSupportRequest, listSupportRequests, updateSupportRequest, addSupportRequestNote, getSupportRequestWithNotes } from '../../services/support-service.js';
export const supportRouter = Router();
// Apply authentication and tenant context
supportRouter.use(requireAuth);
supportRouter.use(setTenantContext);
const createSupportRequestSchema = z.object({
    customerPhone: z.string(),
    customerName: z.string().optional(),
    callId: z.string().optional(),
    orderId: z.string().uuid().optional(),
    requestType: z.enum([
        'order_issue',
        'delivery_problem',
        'payment_issue',
        'general_inquiry',
        'complaint',
        'other'
    ]),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    subject: z.string().min(1),
    description: z.string().min(1),
    aiTranscript: z.any().optional()
});
const updateSupportRequestSchema = z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    assignedTo: z.string().optional(),
    resolvedAt: z.string().optional()
});
const addNoteSchema = z.object({
    note: z.string().min(1),
    isInternal: z.boolean().optional()
});
/**
 * POST /support/requests
 * Create a new support request
 */
supportRouter.post('/requests', async (req, res) => {
    const body = createSupportRequestSchema.parse(req.body);
    const restaurantId = req.user?.role === 'platform_admin'
        ? req.body.restaurantId
        : req.user?.restaurantId;
    if (!restaurantId) {
        return res.status(400).json({ message: 'Restaurant ID is required' });
    }
    const supportRequest = await createSupportRequest({
        restaurantId,
        ...body
    });
    res.status(201).json(supportRequest);
});
/**
 * GET /support/requests
 * List support requests for a restaurant
 */
supportRouter.get('/requests', async (req, res) => {
    const { status } = req.query;
    const restaurantId = req.user?.role === 'platform_admin'
        ? req.query.restaurantId
        : req.user?.restaurantId;
    if (!restaurantId) {
        return res.status(400).json({ message: 'Restaurant ID is required' });
    }
    const requests = await listSupportRequests(restaurantId, status);
    res.json(requests);
});
/**
 * GET /support/requests/:id
 * Get a single support request with notes
 */
supportRouter.get('/requests/:id', async (req, res) => {
    const { id } = req.params;
    const restaurantId = req.user?.role === 'platform_admin'
        ? req.query.restaurantId
        : req.user?.restaurantId;
    if (!restaurantId) {
        return res.status(400).json({ message: 'Restaurant ID is required' });
    }
    const data = await getSupportRequestWithNotes(id, restaurantId);
    res.json(data);
});
/**
 * PATCH /support/requests/:id
 * Update a support request
 */
supportRouter.patch('/requests/:id', async (req, res) => {
    const { id } = req.params;
    const body = updateSupportRequestSchema.parse(req.body);
    const restaurantId = req.user?.role === 'platform_admin'
        ? req.body.restaurantId
        : req.user?.restaurantId;
    if (!restaurantId) {
        return res.status(400).json({ message: 'Restaurant ID is required' });
    }
    const updated = await updateSupportRequest(id, restaurantId, body);
    res.json(updated);
});
/**
 * POST /support/requests/:id/notes
 * Add a note to a support request
 */
supportRouter.post('/requests/:id/notes', async (req, res) => {
    const { id } = req.params;
    const body = addNoteSchema.parse(req.body);
    const note = await addSupportRequestNote(id, req.user.email, body.note, body.isInternal ?? true);
    res.status(201).json(note);
});
