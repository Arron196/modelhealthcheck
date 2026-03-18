INSERT INTO public.check_request_templates (id, name, type, request_header, metadata)
VALUES
  (
    '8e6d6289-b8c8-4b8e-90f6-96e51ec87f01',
    'OpenAI Yes/No Arithmetic',
    'openai',
    NULL,
    '{
      "checkCx": {
        "challengeMode": "yes_no_arithmetic",
        "promptInstruction": "Read the arithmetic statement and answer with ONLY yes or no in lowercase.",
        "cases": [
          {"expression": "1 + 1", "claimedAnswer": 2, "expectedAnswer": "yes"},
          {"expression": "1 + 2", "claimedAnswer": 4, "expectedAnswer": "no"},
          {"expression": "2 + 2", "claimedAnswer": 4, "expectedAnswer": "yes"},
          {"expression": "3 - 1", "claimedAnswer": 1, "expectedAnswer": "no"}
        ]
      }
    }'::jsonb
  ),
  (
    '8e6d6289-b8c8-4b8e-90f6-96e51ec87f02',
    'Anthropic Yes/No Arithmetic',
    'anthropic',
    NULL,
    '{
      "checkCx": {
        "challengeMode": "yes_no_arithmetic",
        "promptInstruction": "Read the arithmetic statement and answer with ONLY yes or no in lowercase.",
        "cases": [
          {"expression": "1 + 1", "claimedAnswer": 2, "expectedAnswer": "yes"},
          {"expression": "1 + 2", "claimedAnswer": 4, "expectedAnswer": "no"},
          {"expression": "2 + 2", "claimedAnswer": 4, "expectedAnswer": "yes"},
          {"expression": "3 - 1", "claimedAnswer": 1, "expectedAnswer": "no"}
        ]
      }
    }'::jsonb
  ),
  (
    '8e6d6289-b8c8-4b8e-90f6-96e51ec87f03',
    'Gemini Yes/No Arithmetic',
    'gemini',
    NULL,
    '{
      "checkCx": {
        "challengeMode": "yes_no_arithmetic",
        "promptInstruction": "Read the arithmetic statement and answer with ONLY yes or no in lowercase.",
        "cases": [
          {"expression": "1 + 1", "claimedAnswer": 2, "expectedAnswer": "yes"},
          {"expression": "1 + 2", "claimedAnswer": 4, "expectedAnswer": "no"},
          {"expression": "2 + 2", "claimedAnswer": 4, "expectedAnswer": "yes"},
          {"expression": "3 - 1", "claimedAnswer": 1, "expectedAnswer": "no"}
        ]
      }
    }'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'dev') THEN
    EXECUTE $sql$
      INSERT INTO dev.check_request_templates (id, name, type, request_header, metadata)
      VALUES
        (
          '8e6d6289-b8c8-4b8e-90f6-96e51ec87f01',
          'OpenAI Yes/No Arithmetic',
          'openai',
          NULL,
          '{
            "checkCx": {
              "challengeMode": "yes_no_arithmetic",
              "promptInstruction": "Read the arithmetic statement and answer with ONLY yes or no in lowercase.",
              "cases": [
                {"expression": "1 + 1", "claimedAnswer": 2, "expectedAnswer": "yes"},
                {"expression": "1 + 2", "claimedAnswer": 4, "expectedAnswer": "no"},
                {"expression": "2 + 2", "claimedAnswer": 4, "expectedAnswer": "yes"},
                {"expression": "3 - 1", "claimedAnswer": 1, "expectedAnswer": "no"}
              ]
            }
          }'::jsonb
        ),
        (
          '8e6d6289-b8c8-4b8e-90f6-96e51ec87f02',
          'Anthropic Yes/No Arithmetic',
          'anthropic',
          NULL,
          '{
            "checkCx": {
              "challengeMode": "yes_no_arithmetic",
              "promptInstruction": "Read the arithmetic statement and answer with ONLY yes or no in lowercase.",
              "cases": [
                {"expression": "1 + 1", "claimedAnswer": 2, "expectedAnswer": "yes"},
                {"expression": "1 + 2", "claimedAnswer": 4, "expectedAnswer": "no"},
                {"expression": "2 + 2", "claimedAnswer": 4, "expectedAnswer": "yes"},
                {"expression": "3 - 1", "claimedAnswer": 1, "expectedAnswer": "no"}
              ]
            }
          }'::jsonb
        ),
        (
          '8e6d6289-b8c8-4b8e-90f6-96e51ec87f03',
          'Gemini Yes/No Arithmetic',
          'gemini',
          NULL,
          '{
            "checkCx": {
              "challengeMode": "yes_no_arithmetic",
              "promptInstruction": "Read the arithmetic statement and answer with ONLY yes or no in lowercase.",
              "cases": [
                {"expression": "1 + 1", "claimedAnswer": 2, "expectedAnswer": "yes"},
                {"expression": "1 + 2", "claimedAnswer": 4, "expectedAnswer": "no"},
                {"expression": "2 + 2", "claimedAnswer": 4, "expectedAnswer": "yes"},
                {"expression": "3 - 1", "claimedAnswer": 1, "expectedAnswer": "no"}
              ]
            }
          }'::jsonb
        )
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END $$;
