#!/bin/bash

# Activate the conda environment "lexi"
source ~/miniconda3/etc/profile.d/conda.sh
conda activate lexi

# Check if the environment was activated successfully
if [ $? -ne 0 ]; then
    echo "Failed to activate conda environment 'lexi'. Exiting."
    exit 1
fi

# Run the Python script "AU_extractor.py"
python AU_extractor.py

# Check if the Python script ran successfully
if [ $? -ne 0 ]; then
    echo "Python script 'AU_extractor.py' failed to execute. Exiting."
    exit 1
fi

echo "Python script 'AU_extractor.py' executed successfully."

