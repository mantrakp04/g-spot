ALTER TABLE `chats`
ADD COLUMN `agent_config` text NOT NULL DEFAULT '{}';
