import { AgentType } from '@models/AppModels';
import { ApiPaths } from '../constants';
import axiosInstance from './AxiosInstance';

export const saveAgent = async (agent: AgentType, isActiveAgent = false): Promise<AgentType> => {
    try {
        const response = await axiosInstance.post(`/${ApiPaths.AGENTS_PATH}`, { agent, isActiveAgent });
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const updateAgent = async (agent: AgentType): Promise<void> => {
    try {
        await axiosInstance.put(`/${ApiPaths.AGENTS_PATH}`, { agent });
        return;
    } catch (error) {
        throw error;
    }
};

export const getAgents = async (): Promise<AgentType[]> => {
    try {
        const response = await axiosInstance.get(`/${ApiPaths.AGENTS_PATH}`);
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const downloadSample = async () => {
    try {
        const response = await axiosInstance.get(`/${ApiPaths.AGENTS_PATH}/download-sample`, {
            responseType: 'blob', // Important for downloading files
        });

        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'sample_rule_sheet.xlsx'); // or any file name you want
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (error) {
        throw error;
    }
};

export const uploadRuleSheet = async (file: File) => {
    try {
        const formData = new FormData();
        formData.append('file', file);

        await axiosInstance.post(`/${ApiPaths.AGENTS_PATH}/upload-rulesheet`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
    } catch (error) {
        throw error;
    }
};
