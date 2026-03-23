UPDATE ai_tasks
SET task_category = CASE
  WHEN LOWER(COALESCE(task_type, '')) LIKE 'edit_%' THEN 'edit'
  WHEN LOWER(COALESCE(task_type, '')) LIKE 'detect_%' THEN 'detect'
  ELSE 'generate'
END
WHERE task_category <> CASE
  WHEN LOWER(COALESCE(task_type, '')) LIKE 'edit_%' THEN 'edit'
  WHEN LOWER(COALESCE(task_type, '')) LIKE 'detect_%' THEN 'detect'
  ELSE 'generate'
END;
