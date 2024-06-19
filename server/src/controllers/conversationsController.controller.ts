import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { conversationsService } from '../services/conversations.service';
import { requestHandler } from '../utils/requestHandler';
//import * as fs from 'fs/promises';
import * as path from 'path';
const fs = require('fs');
import { format } from 'date-fns';
import { TimeSeriesAggregationType } from 'redis';

async function checkFolderExists(folderPath: string): Promise<boolean> {
    try {
      await fs.access(folderPath);
      return true;
    } catch (error) {
      return false;
    }
}

class ConvesationsController {
    message = requestHandler(async (req: Request, res: Response) => {
        const { message, conversationId }: { message: any; conversationId: string } = req.body;
        const response = await conversationsService.message(message, conversationId);
        res.status(200).send({ message: response });
    });


    sendSnap = requestHandler(async (req: Request, res: Response) => {
        //console.log("I am in function");
        try{
            //console.log("Hello world");
            const { image, conversationId, experimentId }: { image, conversationId: string , experimentId: string} = req.body;
            const temp = `${conversationId}_${experimentId}`;
            const folderPath = path.join("webcamBase/", temp);
            const now = new Date();
            const formattedDateTime = format(now, 'yyyyMMddHHmmss');
            //console.log('Image data:', image);
            const parts = image.split(',');
            if (parts.length < 2) {
                console.error('Invalid base64 image data');
                process.exit(1);
            }
            const base64Data = parts[1];
            // Debug: Check base64 string
            //console.log(base64Data.length); // Should be a large number
            //console.log(base64Data.substring(0, 30)); // Check first few characters

            // Convert to buffer
            const buffer = Buffer.from(base64Data, 'base64');

            checkFolderExists(folderPath).then((exists) => {
                if (exists) {
                    console.log('Folder exists');
                    //const buffer = Buffer.from(image.split(',')[1], 'base64');
                    fs.writeFileSync(`${folderPath}/${formattedDateTime}.png`, buffer);
                    res.sendStatus(200);
                } else {
                    try{
                        console.log('Folder does not exist');
                        fs.mkdirSync(folderPath);
                        console.log('Folder created successfully');
                    } catch(err) {
                        console.log(err)
                    }
                    //const buffer = Buffer.from(image.split(',')[1], 'base64');
                    fs.writeFileSync(`${folderPath}/${formattedDateTime}.png`, buffer);
                    res.sendStatus(200);
                }})
        }
        catch (err) {
            console.log(err);
        }
    });

    streamMessage = requestHandler(
        async (req: Request, res: Response) => {
            const conversationId = req.query.conversationId as string;
            const role = req.query.role as string;
            const content = req.query.content as string;
            const message = { role, content };

            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });

            const streamResponse = async (partialMessage) => {
                res.write(`data: ${JSON.stringify({ message: partialMessage })}\n\n`);
            };

            const closeStream = async () => {
                res.write('event: close\ndata: \n\n');
                res.end();
            };

            await conversationsService.message(message, conversationId, streamResponse);
            closeStream();
        },
        (req, res) => {
            res.write(`data: ${JSON.stringify({ error: 'Internal Server Error' })}\n\n`);
            res.end();
        },
    );

    createConversation = requestHandler(async (req: Request, res: Response) => {
        const { userId, numberOfConversations, experimentId } = req.body;
        const conversationId = await conversationsService.createConversation(
            userId,
            numberOfConversations,
            experimentId,
        );
        res.cookie('conversationId', conversationId, {
            secure: true,
            sameSite: 'none',
        });
        res.status(200).send(conversationId);
    });

    getConversation = requestHandler(async (req: Request, res: Response) => {
        const conversationId = req.query.conversationId as string;

        if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
            res.status(401).send('Invalid convesationId');
            console.warn(`Invalid convesationId: ${conversationId}`);
            return;
        }

        const conversation = await conversationsService.getConversation(conversationId);
        const conversationMetaData = await conversationsService.getConversationMetadata(conversationId);
        //console.log(conversationMetaData);
        res.status(200).send({"conversation": conversation, "conversationMetaData": conversationMetaData});
    });

    updateIms = requestHandler(async (req: Request, res: Response) => {
        const { conversationId, imsValues, isPreConversation } = req.body;

        await conversationsService.updateIms(conversationId, imsValues, isPreConversation);

        res.status(200).send();
    });
}

export const convesationsController = new ConvesationsController();
