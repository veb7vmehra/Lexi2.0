import { Router } from 'express';
import { fdc } from '../controllers/folderDownloadController.controller'

export const folderDownloadRouter = () => {
    const router = Router();
    router.get('/', fdc.getActionUnits);
    return router;
};
