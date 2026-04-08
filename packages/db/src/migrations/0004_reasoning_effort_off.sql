UPDATE `chats`
SET `agent_config` = json_set(
  CASE
    WHEN json_valid(`agent_config`) THEN `agent_config`
    ELSE '{}'
  END,
  '$.modelId',
  coalesce(
    json_extract(
      CASE
        WHEN json_valid(`agent_config`) THEN `agent_config`
        ELSE '{}'
      END,
      '$.modelId'
    ),
    `model`
  ),
  '$.thinkingLevel',
  coalesce(
    json_extract(
      CASE
        WHEN json_valid(`agent_config`) THEN `agent_config`
        ELSE '{}'
      END,
      '$.thinkingLevel'
    ),
    'off'
  )
)
WHERE NOT json_valid(`agent_config`)
   OR json_type(
        CASE
          WHEN json_valid(`agent_config`) THEN `agent_config`
          ELSE '{}'
        END,
        '$.modelId'
      ) IS NULL
   OR json_type(
        CASE
          WHEN json_valid(`agent_config`) THEN `agent_config`
          ELSE '{}'
        END,
        '$.thinkingLevel'
      ) IS NULL;
