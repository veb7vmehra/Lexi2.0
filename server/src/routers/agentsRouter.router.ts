import { Router } from 'express';
import { agentsController } from '../controllers/agentsController.controller';

export const agentsRouter = () => {
    const router = Router();
    router.post('/', agentsController.saveAgent);
    router.get('/', agentsController.getAgents);
    router.get('/:id', agentsController.getAgentLean);
    router.put('/', agentsController.updateAgent);
    router.get('/download-sample', agentsController.downloadSample);
    router.post('/upload-rulesheet', agentsController.uploadRuleSheet);
    router.delete('/:id', agentsController.deleteAgent);

    return router;
};
