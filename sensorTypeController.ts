import { Request, Response } from 'express';
import dayjs from 'dayjs';
import { connectToDatabase } from './database'; // Adjust import path as needed

export const getSensorsTypeList = async (req: Request, res: Response): Promise<void> => {
    const clientId = parseInt(req.query.clientId as string);
    const requestedDate = (req.query.date as string | undefined) || dayjs().format('YYYY-MM-DD');

    if (!clientId || isNaN(clientId)) {
        res.status(400).send('Valid clientId parameter is required');
        return;
    }

    try {
        const db = await connectToDatabase();
        const startDate = dayjs(requestedDate).startOf('month').format('YYYY-MM-DD 00:00:00');
        const endDate = dayjs(requestedDate).endOf('month').format('YYYY-MM-DD 23:59:59');

        // Fetch integrations with their product catalogs
        const [integrationRows]: [any[], any] = await db.query(`
            SELECT id, product_catalog FROM integrations WHERE id IN (3, 4)
        `);

        // Build a map of integration id to product catalog
        const integrationCatalogs: { [id: number]: any } = {};

        integrationRows.forEach(row => {
            if (row.product_catalog) {
                try {
                    let catalog: any;

                    if (typeof row.product_catalog === 'string') {
                        catalog = JSON.parse(row.product_catalog);
                    } else {
                        catalog = row.product_catalog;
                    }

                    if (catalog && typeof catalog === 'object') {
                        integrationCatalogs[row.id] = catalog;
                    }
                } catch (error) {
                    console.error('Error processing product catalog:', error);
                }
            }
        });

        console.log('Integration catalogs:', integrationCatalogs);

        // Fetch device history with manufacturerId, ordered by latest changeAt
        const [deviceRows]: [any[], any] = await db.query(`
            WITH DeviceTimeline AS (
                SELECT
                    deviceId,
                    sensorName,
                    manufacturerId,
                    deviceState,
                    changeAt,
                    LEAD(deviceState) OVER (PARTITION BY deviceId ORDER BY changeAt) as nextState,
                    LEAD(changeAt) OVER (PARTITION BY deviceId ORDER BY changeAt) as nextStateDate
                FROM deviceHistory
                WHERE clientId = ?
                AND (manufacturerId = 3 OR manufacturerId = 4)
                AND changeAt <= ?
            )
            SELECT deviceId, sensorName, manufacturerId, changeAt
            FROM DeviceTimeline
            WHERE deviceState = 'ACTIVATED'
            AND (
                (nextState IS NULL)
                OR
                (nextState IN ('UNASSIGNED', 'DEACTIVATED') AND nextStateDate > ?)
                OR
                (changeAt BETWEEN ? AND ?)
                OR
                (changeAt <= ? AND (nextState IS NULL OR nextStateDate >= ?))
            )
            GROUP BY deviceId, sensorName
            ORDER BY changeAt DESC
        `, [clientId, endDate, endDate, startDate, endDate, startDate, startDate]);

        const finalOutput: { [sensorName: string]: string } = {};

        // Process devices in order of latest changeAt (descending)
        // Match manufacturerId with integration id and look up sensorName in product_catalog
        // Once a sensorName has a product, it won't be updated
        deviceRows.forEach(row => {
            if (row.sensorName && row.manufacturerId) {
                const catalog = integrationCatalogs[row.manufacturerId];

                if (catalog && catalog[row.sensorName]) {
                    // Only assign if sensorName doesn't already have a product name
                    if (!finalOutput[row.sensorName]) {
                        finalOutput[row.sensorName] = catalog[row.sensorName];
                    }
                }
            }
        });

        res.send(finalOutput);

    } catch (error) {
        console.error('Error fetching sensor types:', error);
        res.status(500).send('Error fetching sensor types');
    }
};
