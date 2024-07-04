import { Request, Response } from 'express';
import { agentsService } from '../services/agents.service';
import { requestHandler } from '../utils/requestHandler';
import path from 'path';

class AgentsController {
    getAgents = requestHandler(async (req: Request, res: Response) => {
        const agents = await agentsService.getAllAgents();
        res.status(200).send(agents);
    });

    saveAgent = requestHandler(async (req: Request, res: Response) => {
        const { agent } = req.body;
        const savedSetting = await agentsService.saveAgent(agent);
        res.status(200).send(savedSetting);
    });

    updateAgent = requestHandler(async (req: Request, res: Response) => {
        const { agent } = req.body;
        const response = await agentsService.updateAgents(agent);
        res.status(200).send(response);
    });

    downloadSample = requestHandler(async (req: Request, res: Response) => {
        const filePath = path.join(__dirname, '../../sample_rule_sheet.xlsx'); // specify the path to your file here
        console.log(filePath)
        res.download(filePath, 'sample_rule_sheet.xlsx', (err) => {
            if (err) {
                res.status(500).send({
                    message: 'Error downloading the file',
                    error: err,
                });
            }
        });
    });

    /*downloadSample = requestHandler(async (req: Request, res: Response) => {
        const { agent } = req.body;
        const response = await agentsService.updateAgents(agent);
        res.status(200).send(response);
    });*/

    uploadRuleSheet = requestHandler(async (req: Request, res: Response) => {
        const { agent } = req.body;
        const response = await agentsService.updateAgents(agent);
        res.status(200).send(response);
    });
}

export const agentsController = new AgentsController();
