/**
 * Next.js Integration Example
 * 
 * This file shows how to call the Automation Runner from your Next.js application.
 * Copy this code into your Next.js API route or component.
 */

// Example 1: API Route (app/api/execute-workflow/route.ts)
export async function POST(request: Request) {
  try {
    const { workflow, initialData, tokens } = await request.json();

    // Call Automation Runner
    const response = await fetch('http://localhost:3001/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow,              // The workflow JSON object
        initialData: initialData || {},
        tokens: {
          googleAccessToken: tokens.googleAccessToken,
          openAiApiKey: tokens.openAiApiKey,
        },
      }),
    });

    const result = await response.json();
    return Response.json(result);
  } catch (error: any) {
    return Response.json(
      { error: 'Failed to execute workflow', details: error.message },
      { status: 500 }
    );
  }
}

// Example 2: Client-side function
export async function executeWorkflowFromClient(
  workflow: any,
  tokens: { googleAccessToken: string; openAiApiKey: string },
  initialData?: any
) {
  try {
    const response = await fetch('/api/execute-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow,
        initialData: initialData || {
          body: {
            survey_data: "What is your favorite programming language? JavaScript, Python, Java"
          }
        },
        tokens,
      }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error executing workflow:', error);
    throw error;
  }
}

// Example 3: Complete usage example
/*
import surveyWorkflow from './test-survey-simplified-workflow.json';

async function testWorkflow() {
  const tokens = {
    googleAccessToken: 'ya29.a0ATi6K2ud7kwTfHBKIeIoBS2mxVQq-...',
    openAiApiKey: 'sk-...',
  };

  const result = await executeWorkflowFromClient(
    surveyWorkflow,
    tokens,
    {
      body: {
        survey_data: "What is your favorite programming language?"
      }
    }
  );

  if (result.success) {
    console.log('✅ Workflow executed successfully!');
    console.log('Outputs:', result.outputs);
  } else {
    console.error('❌ Errors:', result.errors);
  }
}
*/

