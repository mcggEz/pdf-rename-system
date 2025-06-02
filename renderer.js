const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

let selectedFiles = [];
let currentlySelectedFile = null;

document.getElementById('import-button').addEventListener('click', () => {
  ipcRenderer.send('open-file-dialog');
});

ipcRenderer.on('selected-file', (event, filePath) => {
  console.log('Selected file:', filePath);
  
  // Check if file already exists in selectedFiles
  const isDuplicate = selectedFiles.some(file => file.path === filePath);
  
  if (isDuplicate) {
    alert('This file has already been imported.');
    return;
  }
  
  selectedFiles.push({
    path: filePath,
    name: path.basename(filePath)
  });
  renderSidebar();
});

async function analyzePDF(filePath) {
  try {
    // Read the PDF file as binary data
    const pdfData = fs.readFileSync(filePath);
    
    // Initialize Gemini model
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    // Convert PDF to base64
    const base64Data = pdfData.toString('base64');
    
    // Create the prompt for Gemini
    const prompt = `Analyze this pdf file and extract the following information:

1. Unique Identifier: Look for the number that appears on the right side of "Unique Identifier" or "Identifier No." The number should be in the format XX-XXXX.

Please provide the information in this exact format:
Identifier Number: [XX-XXXX]`;

    // Get response from Gemini
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "application/pdf",
          data: base64Data
        }
      }
    ]);
    
    const response = await result.response;
    const text = response.text();
    
    // Parse the response
    const registryMatch = text.match(/Registry Number: (.*)/);
    const nameMatch = text.match(/Name: (.*)/);
    
    return {
      registryNumber: registryMatch ? registryMatch[1].trim() : null,
      name: nameMatch ? nameMatch[1].trim() : null
    };
  } catch (error) {
    console.error('Error analyzing PDF:', error);
    throw error;
  }
}

async function renameFile(oldPath, newName) {
  try {
    const newPath = path.join(path.dirname(oldPath), newName);
    console.log('Renaming from:', oldPath);
    console.log('Renaming to:', newPath);
    
    // Check if the new name would create a duplicate
    const isDuplicate = selectedFiles.some(f => f.path === newPath);
    if (isDuplicate) {
      throw new Error('A file with this name already exists.');
    }
    
    // Rename the file
    await fs.promises.rename(oldPath, newPath);
    console.log('File renamed successfully');
    
    // Update the file path in selectedFiles
    const fileIndex = selectedFiles.findIndex(f => f.path === oldPath);
    if (fileIndex !== -1) {
      selectedFiles[fileIndex].path = newPath;
      selectedFiles[fileIndex].name = newName;
      
      // Update currentlySelectedFile if it was the renamed file
      if (currentlySelectedFile && currentlySelectedFile.path === oldPath) {
        currentlySelectedFile.path = newPath;
        currentlySelectedFile.name = newName;
        
        // Clear the PDF viewer first
        const pdfViewer = document.getElementById('pdf-viewer');
        pdfViewer.innerHTML = '';
        
        // Small delay to ensure the iframe is cleared
        setTimeout(() => {
          // Update the PDF viewer with the new path
          renderPDF(newPath);
          document.getElementById('current-file').textContent = newPath;
        }, 100);
      }
    }
    
    return newPath;
  } catch (error) {
    console.error('Error renaming file:', error);
    throw error;
  }
}

function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `<h3>Selected Files (${selectedFiles.length})</h3>`;
  
  selectedFiles.forEach((file, index) => {
    const fileElement = document.createElement('div');
    fileElement.className = 'file-item';
    
    const fileNameSpan = document.createElement('span');
    fileNameSpan.className = 'file-name';
    fileNameSpan.textContent = file.name;
    
    const editButton = document.createElement('button');
    editButton.className = 'edit-button';
    editButton.textContent = '✏️';
    editButton.title = 'Rename file';
    
    const removeButton = document.createElement('button');
    removeButton.className = 'remove-button';
    removeButton.textContent = '🗑️';
    removeButton.title = 'Remove file';
    
    fileElement.appendChild(fileNameSpan);
    fileElement.appendChild(editButton);
    fileElement.appendChild(removeButton);
    
    // Click on file name to view PDF
    fileNameSpan.addEventListener('click', () => {
      // Remove selected class from all files
      document.querySelectorAll('#sidebar .file-item').forEach(div => {
        div.classList.remove('selected');
      });
      
      // Add selected class to clicked file
      fileElement.classList.add('selected');
      
      // Store the currently selected file
      currentlySelectedFile = file;
      
      renderPDF(file.path);
      document.getElementById('current-file').textContent = file.path;
    });
    
    // Edit button click handler
    editButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'file-name-input';
      input.value = file.name;
      
      // Replace the span with input
      fileElement.replaceChild(input, fileNameSpan);
      input.focus();
      
      // Handle input completion
      const handleInputComplete = async () => {
        const newName = input.value.trim();
        if (newName && newName !== file.name) {
          try {
            await renameFile(file.path, newName);
            renderSidebar();
          } catch (error) {
            alert(error.message || 'Failed to rename file. Please try again.');
            renderSidebar();
          }
        } else {
          renderSidebar();
        }
      };
      
      // Handle Enter key and blur
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          handleInputComplete();
        }
      });
      
      input.addEventListener('blur', handleInputComplete);
    });
    
    // Remove button click handler
    removeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to remove "${file.name}"?`)) {
        // Remove from selectedFiles array
        selectedFiles = selectedFiles.filter(f => f.path !== file.path);
        
        // If the removed file was selected, clear the viewer
        if (currentlySelectedFile && currentlySelectedFile.path === file.path) {
          currentlySelectedFile = null;
          document.getElementById('pdf-viewer').innerHTML = '';
          document.getElementById('current-file').textContent = '';
        }
        
        renderSidebar();
      }
    });
    
    sidebar.appendChild(fileElement);
  });
}

function renderPDF(filePath) {
  const pdfViewer = document.getElementById('pdf-viewer');
  try {
    // Convert backslashes to forward slashes and ensure proper encoding
    const fileUrl = `file:///${filePath.replace(/\\/g, '/').replace(/#/g, '%23')}`;
    
    console.log('Original path:', filePath);
    console.log('File URL:', fileUrl);
    
    // Create iframe with error handling
    const iframe = document.createElement('iframe');
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.frameBorder = '0';
    iframe.onerror = (error) => {
      console.error('Error loading PDF:', error);
      pdfViewer.innerHTML = '<p>Error loading PDF. Please try again.</p>';
    };
    iframe.src = fileUrl;
    
    // Clear and update viewer
    pdfViewer.innerHTML = '';
    pdfViewer.appendChild(iframe);
  } catch (error) {
    console.error('Error in renderPDF:', error);
    pdfViewer.innerHTML = '<p>Error loading PDF. Please try again.</p>';
  }
}

// Update the rename button click handler to use the new format
document.getElementById('rename-button').addEventListener('click', async () => {
  if (selectedFiles.length === 0) {
    alert('Please import files first.');
    return;
  }

  if (selectedFiles.length === 1) {
    // If only one file, use the original single-file logic
    if (!currentlySelectedFile) {
      alert('Please select a file first.');
      return;
    }

    const renameButton = document.getElementById('rename-button');
    const originalText = renameButton.textContent;
    
    try {
      // Show loading state
      renameButton.textContent = '⌛';
      renameButton.disabled = true;

      // Analyze the PDF
      const pdfData = await analyzePDF(currentlySelectedFile.path);
      
      if (pdfData.registryNumber && pdfData.name) {
        const newName = `${pdfData.registryNumber}, ${pdfData.name}.pdf`;
        await renameFile(currentlySelectedFile.path, newName);
        renderSidebar();
      } else {
        alert('Could not extract registry number or name from the PDF.');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error analyzing PDF. Please try again.');
    } finally {
      // Always restore button state, even if there's an error
      renameButton.textContent = originalText;
      renameButton.disabled = false;
    }
  } else {
    // If multiple files, use the new renameAllFiles function
    await renameAllFiles();
  }
});

// Update the renameAllFiles function to use the new format
async function renameAllFiles() {
  const renameButton = document.getElementById('rename-button');
  const originalText = renameButton.textContent;
  
  try {
    // Show loading state
    renameButton.textContent = '⌛';
    renameButton.disabled = true;

    // Process files one by one
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      try {
        // Update button to show progress
        renameButton.textContent = `⌛ (${i + 1}/${selectedFiles.length})`;
        
        // Analyze the PDF
        const pdfData = await analyzePDF(file.path);
        
        if (pdfData.registryNumber && pdfData.name) {
          const newName = `${pdfData.registryNumber}, ${pdfData.name}.pdf`;
          await renameFile(file.path, newName);
          renderSidebar();
        } else {
          console.warn(`Could not extract data from file: ${file.name}`);
        }
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in renameAllFiles:', error);
    alert('Error processing files. Please check the console for details.');
  } finally {
    // Restore button state
    renameButton.textContent = originalText;
    renameButton.disabled = false;
  }
} 
