import { Router } from 'express';
import { convesationsController } from '../controllers/conversationsController.controller';

export const conversationsRouter = () => {
    const router = Router();
    router.get('/conversation', convesationsController.getConversation);
    router.post('/message', convesationsController.message);
    router.post('/audio', convesationsController.audio);
    router.get('/message/stream', convesationsController.streamMessage);
    router.post('/create', convesationsController.createConversation);
    router.put('/metadata', convesationsController.updateConversationMetadata);
    router.put('/annotation', convesationsController.updateUserAnnotation);
    router.post('/finish', convesationsController.finishConversation);
    router.post('/sendSnap', convesationsController.sendSnap);
    
    return router;
};
