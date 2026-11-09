-- Resultado de la toma: número de conteo (VALIDACION: PRIMERA = 1, SEGUNDA = 2, TERCERA = 3) y diferencia con signo.
-- El reporte trae DIFERENCIA en positivo (el signo está en ESTADO): se guarda CONTADO − SISTEMA (faltante < 0, sobrante > 0).
ALTER TABLE inv_resultado ADD COLUMN IF NOT EXISTS conteo smallint;
UPDATE inv_resultado SET
  conteo = CASE WHEN upper(coalesce(validacion, '')) ~ '^(SEG|2)' THEN 2 WHEN upper(coalesce(validacion, '')) ~ '^(TER|3)' THEN 3 ELSE 1 END,
  diferencia = coalesce(contado, 0) - coalesce(sistema, 0);
CREATE INDEX IF NOT EXISTS inv_resultado_clave ON inv_resultado (cd, ubicacion, sku, fecha);
