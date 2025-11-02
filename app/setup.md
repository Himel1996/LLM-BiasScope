# LLM Bias Scope - Setup Guide

This guide will walk you through setting up the LLM Bias Scope application from scratch. Follow these steps in order to get the project running.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

1. **Node.js** (Version 20.x or higher)
   - Download from: https://nodejs.org/
   - Verify installation: `node --version`

2. **pnpm** (Version 10.20.0 or higher)
   - Install via npm: `npm install -g pnpm@10.20.0`
   - Verify installation: `pnpm --version`

3. **Git** (optional, for cloning the repository)
   - Download from: https://git-scm.com/

For detailed dependency information, refer to [requirements.md](./requirements.md).

## Step 1: Clone or Download the Project

If you have the project in a Git repository:
```bash
git clone <repository-url>
cd LLM-BiasScope
```

Or if you have the project files already, navigate to the project directory:
```bash
cd LLM-BiasScope
```

## Step 2: Install Root Dependencies

The project has dependencies at two levels. First, install the root-level dependencies (AI SDK and backend libraries):

```bash
# From the project root directory
pnpm install
```

This will install:
- `@ai-sdk/react` - React hooks for AI SDK
- `ai` - Vercel AI SDK core library
- `zod` - TypeScript schema validation
- `dotenv` - Environment variable management
- `tsx` - TypeScript execution engine

## Step 3: Install App Dependencies

Navigate to the `app` directory and install the frontend dependencies:

```bash
cd app
pnpm install
```

This will install:
- Next.js, React, and React DOM
- Recharts (for data visualization)
- react-markdown and remark-gfm (for markdown rendering)
- jsPDF and html2canvas (for PDF export)
- TypeScript and development dependencies

## Step 4: Set Up Environment Variables

The application requires a Hugging Face API token for bias detection. You'll need to:

1. **Get a Hugging Face API Token**:
   - Sign up at https://huggingface.co/ (if you don't have an account)
   - Go to https://huggingface.co/settings/tokens
   - Create a new token with read access

2. **Create Environment File**:
   
   In the **root directory** (not the `app` directory), create a `.env.local` file:
   
   ```bash
   # From project root
   touch .env.local
   ```
   
   Or create it manually with the following content:
   
   ```
   HUGGINGFACE_TOKEN=your_huggingface_token_here
   ```
   
   Replace `your_huggingface_token_here` with your actual Hugging Face token.

3. **Optional Environment Variables**:
   
   If you're using custom Hugging Face endpoints, you can also add:
   
   ```
   DETECTOR_ENDPOINT=https://your-custom-detector-endpoint.com
   TYPE_CLASSIFIER_ENDPOINT=https://your-custom-classifier-endpoint.com
   ```
   
   If not specified, the application will use default endpoints.

## Step 5: Verify Project Structure

Your project structure should look like this:

```
LLM-BiasScope/
├── .env.local                 # Environment variables (you created this)
├── package.json               # Root dependencies
├── pnpm-lock.yaml            # Root lock file
├── node_modules/              # Root dependencies
├── app/
│   ├── package.json          # App dependencies
│   ├── pnpm-lock.yaml        # App lock file
│   ├── node_modules/         # App dependencies
│   ├── src/
│   │   └── app/
│   │       ├── api/
│   │       │   ├── bias/
│   │       │   │   └── route.ts
│   │       │   └── chat/
│   │       │       └── route.ts
│   │       ├── page.tsx       # Main application page
│   │       ├── layout.tsx
│   │       └── globals.css
│   └── ...
└── ...
```

## Step 6: Start the Development Server

From the `app` directory, start the Next.js development server:

```bash
# Make sure you're in the app directory
cd app
pnpm dev
```

The server will start on `http://localhost:3000` by default.

You should see output similar to:
```
▲ Next.js 16.0.1
- Local:        http://localhost:3000
```

## Step 7: Access the Application

Open your web browser and navigate to:

```
http://localhost:3000
```

You should see the LLM Bias Scope application interface with:
- Two model conversation columns side-by-side
- Model selection dropdowns
- Input area for sending messages
- Bias analysis visualization sections

## Troubleshooting

### Issue: `pnpm: command not found`

**Solution**: Install pnpm globally:
```bash
npm install -g pnpm@10.20.0
```

### Issue: `Error: Missing HUGGINGFACE_TOKEN`

**Solution**: 
- Make sure you created `.env.local` in the **root directory** (not in `app/`)
- Verify the token is correct and has no extra spaces
- Restart the development server after creating/modifying `.env.local`

### Issue: `Module not found` errors

**Solution**: 
- Ensure you ran `pnpm install` in both the root directory and the `app` directory
- Delete `node_modules` and `pnpm-lock.yaml` in both locations, then reinstall:
  ```bash
  # From root
  rm -rf node_modules pnpm-lock.yaml
  pnpm install
  
  # From app directory
  cd app
  rm -rf node_modules pnpm-lock.yaml
  pnpm install
  ```

### Issue: Port 3000 is already in use

**Solution**: 
- Stop the other application using port 3000, or
- Run on a different port:
  ```bash
  pnpm dev -- -p 3001
  ```

### Issue: TypeScript errors

**Solution**: 
- Make sure TypeScript is installed: `pnpm install typescript@^5 -D`
- Verify all type definitions are installed in the `app` directory

### Issue: Bias detection API fails

**Solution**: 
- Verify your `HUGGINGFACE_TOKEN` is valid and active
- Check that the token has access to the required models:
  - `himel7/bias-detector`
  - `maximuspowers/bias-type-classifier`
- Check the browser console and server logs for detailed error messages

## Building for Production

To create a production build:

```bash
cd app
pnpm build
```

To start the production server:

```bash
pnpm start
```

## Project Structure Overview

- **Root directory**: Contains AI SDK dependencies and environment configuration
- **`app/` directory**: Next.js application with frontend code
- **`app/src/app/api/`**: API route handlers for chat and bias analysis
- **`app/src/app/page.tsx`**: Main application component
- **`app/src/app/globals.css`**: Global styles and theme variables

## Next Steps

Once the application is running:

1. **Select Models**: Use the dropdown menus in each column to choose LLM models to compare
2. **Start a Conversation**: Type a message and send it to both models
3. **View Bias Analysis**: The bias insights section will automatically analyze both prompts and responses
4. **Compare Models**: Use the model comparison chart to see differences in bias patterns
5. **Export Results**: Use the Export button to download conversations as JSON or PDF

## Additional Resources

- For detailed dependency information, see [requirements.md](./requirements.md)
- For API documentation, check the Next.js API routes documentation
- For AI SDK usage, visit https://sdk.vercel.ai/docs

## Getting Help

If you encounter issues not covered in this guide:

1. Check the browser console for client-side errors
2. Check the terminal where the dev server is running for server-side errors
3. Verify all dependencies are correctly installed
4. Ensure environment variables are properly configured
5. Check that you're using the correct Node.js and pnpm versions

---

**Note**: This application requires an active internet connection to:
- Access LLM models through Vercel AI Gateway
- Call Hugging Face Inference API for bias detection

