import { Request, Response } from 'express';
//import { dataAggregationService } from '../services/dataAggregation.service';
import { requestHandler } from '../utils/requestHandler';
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

class FolderDownloadController {
    getActionUnits = requestHandler(async (req: Request, res: Response) => {
        console.log("We in function");
        const experimentId = req.query.folderName as string;
        console.log(experimentId);
        const folderPath = `./action_units/${experimentId}`;
        console.log(folderPath);
        const absoluteFolderPath = path.resolve(folderPath);
        console.log(absoluteFolderPath);
        if (!fs.existsSync(absoluteFolderPath)) {
            return res.status(404).send('Folder not found');
        }
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=${path.basename(absoluteFolderPath)}.zip`);

        const archive = archiver('zip', {
            zlib: { level: 9 } // Compression level
        });

        archive.on('error', (err) => {
            res.status(500).send({ error: err.message });
        });

        archive.pipe(res);

        archive.directory(absoluteFolderPath, false);

        archive.finalize();
        //const response = await dataAggregationService.getExperimentData(experimentId);
        //res.status(200).send({ message: response });
    });

}

export const fdc = new FolderDownloadController();
