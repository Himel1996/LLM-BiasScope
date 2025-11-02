# LLM Bias Scope - Requirements & Dependencies

## System Requirements

- **Node.js**: Version 20.x or higher
- **Package Manager**: pnpm 10.20.0 or higher
- **TypeScript**: 5.x

## Production Dependencies

### Root Dependencies (`/package.json`)
These are the core AI SDK dependencies needed for the backend API routes:

- **@ai-sdk/react**: ^2.0.86 - React hooks for AI SDK
- **ai**: ^5.0.86 - Vercel AI SDK core library
- **zod**: ^4.1.12 - TypeScript-first schema validation
- **dotenv**: ^17.2.3 - Environment variable management
- **tsx**: ^4.20.6 - TypeScript execution engine

### App Dependencies (`/app/package.json`)
These are the frontend application dependencies:

#### Core Framework
- **next**: ^16.0.1 - Next.js React framework
- **react**: ^19.2.0 - React library
- **react-dom**: ^19.2.0 - React DOM renderer

#### Data Visualization
- **recharts**: ^3.3.0 - Composable charting library for React
  - Used for: Bias distribution charts, radar charts, comparison bar charts

#### Markdown Rendering
- **react-markdown**: ^10.1.0 - React component for rendering markdown
- **remark-gfm**: ^4.0.1 - GitHub Flavored Markdown plugin for react-markdown

#### Export Functionality
- **jspdf**: ^3.0.3 - PDF generation library
- **html2canvas**: ^1.4.1 - HTML to canvas/image conversion (used with jsPDF)

## Development Dependencies

### TypeScript & Types
- **typescript**: ^5 - TypeScript compiler
- **@types/node**: ^20 - Node.js type definitions
- **@types/react**: ^19 - React type definitions
- **@types/react-dom**: ^19 - React DOM type definitions

### Styling
- **tailwindcss**: ^4 - Utility-first CSS framework
- **@tailwindcss/postcss**: ^4 - PostCSS plugin for Tailwind CSS

### Code Quality
- **eslint**: ^9 - JavaScript/TypeScript linter
- **eslint-config-next**: ^16.0.1 - Next.js ESLint configuration

### Build Tools
- **babel-plugin-react-compiler**: 1.0.0 - React compiler plugin

## Environment Variables

Required environment variables for the application to function:

### AI/LLM Configuration
- **HUGGINGFACE_TOKEN** (Required) - Hugging Face API token for bias detection models
  - Used for: Bias detection and classification API calls

### Optional Configuration
- **DETECTOR_ENDPOINT** (Optional) - Custom Hugging Face endpoint for bias detector
  - Default: `https://s8ssn54aflavbtbq.eu-west-1.aws.endpoints.huggingface.cloud`
  
- **TYPE_CLASSIFIER_ENDPOINT** (Optional) - Custom Hugging Face endpoint for bias type classifier
  - Default: `https://wf6r2gdi8kklbqvp.us-east-1.aws.endpoints.huggingface.cloud`

### Models Used
- **Bias Detector**: `himel7/bias-detector`
- **Bias Type Classifier**: `maximuspowers/bias-type-classifier`

## Installation Instructions

1. **Install pnpm** (if not already installed):
   ```bash
   npm install -g pnpm@10.20.0
   ```

2. **Install root dependencies**:
   ```bash
   pnpm install
   ```

3. **Install app dependencies**:
   ```bash
   cd app
   pnpm install
   ```

4. **Set up environment variables**:
   Create a `.env.local` file in the root directory with:
   ```
   HUGGINGFACE_TOKEN=your_token_here
   ```

5. **Run the development server**:
   ```bash
   cd app
   pnpm dev
   ```

## API Dependencies

### External Services
- **Vercel AI Gateway** - Used for LLM model routing (automatic with AI SDK)
- **Hugging Face Inference API** - Used for bias detection and classification

### Supported LLM Models
The application supports multiple LLM providers through Vercel AI Gateway:
- OpenAI (GPT models)
- Google (Gemini models)
- Anthropic (Claude models)
- DeepSeek
- xAI (Grok)
- MiniMax
- Mistral
- Meituan (LongCat Flash Chat)

## Browser Compatibility

The application uses modern web APIs and requires:
- **ES6+ support**
- **LocalStorage API** (for chat history persistence)
- **Modern CSS features** (CSS Grid, Flexbox, Custom Properties)

Recommended browsers:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

