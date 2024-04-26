import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import lodash from "lodash";

if (!fs.existsSync('.env')) {
    console.error('No .env file found');
    process.exit(1);
}

dotenv.config();

const requiredEnvVars = ['BASE_URL', 'API_KEY', 'HASH'];

if (!requiredEnvVars.every((envVar) => process.env[envVar])) {
    console.error('Missing required environment variables');
    process.exit(1);
}

const BASE_URL = process.env.BASE_URL;
const API_KEY = process.env.API_KEY;
const HASH = process.env.HASH;


enum Label {
    REVENUE = '1e7c5038-52f6-452b-9d40-cac8e572920a',
    IGNORE = '845eb3d0-2f73-4848-93fe-2f90efbc4d43',
}

interface Movement {
    id: string;
    transaction_id: string;
    transaction_hash: string;
    transaction_date: number;
    source_id: string;
    other_party: object;
    volume: string;
    asset_to_usd_rate: string;
    usd_to_fiat_rate: string;
    is_fee: boolean;
    direction: 'in' | 'out';
    asset: string;
    labels: any[];
    cost_basis: string | null;
    gains: string | null;
    cost_basis_error: any;
}

interface ResponseData {
    data: Movement[];
    cursor: string | null;
}

const axiosInstance = axios.create({
    baseURL: BASE_URL,
    headers: {
        'cryptio-api-key': API_KEY,
    },
    timeout: 1000,
});

const getMovementsFromTransactionHash = async (transactionHash: string | undefined, cursor: string | null): Promise<ResponseData> => {
    try {
        const response = await axiosInstance.get(`movement`, {
            params: {
                transaction_hashes: transactionHash,
                cursor,
            },
        });
        return response.data;
    } catch (error) {
        // console.error('Error fetching movements', error);
        throw new Error('Error fetching movements');
    }
};

const getAllMovementsFromTransactionHash = async (transactionHash: string | undefined): Promise<Movement[]> => {
    let movements: any = [];
    let cursor = null;
    try {
        do {
            const response = await getMovementsFromTransactionHash(transactionHash, cursor);
            movements = [...movements, ...response.data];
            cursor = response.cursor;
        } while (cursor);
        return movements;
    } catch (error) {
        throw new Error('Error fetching movements');
    }
};

const updateMovementLabel = async (movementIds: string[], label: string) => {
    try {
        await axiosInstance.post(`label/${label}/apply`, {movements: movementIds});
    } catch (error) {
        // console.error('Error updating label', error);
        throw new Error('Error updating labels');
    }
};

const groupMovementsByVolume = (movements: Movement[]) => {
    const assetMovement = lodash.groupBy(movements, 'asset');
    return lodash.mapValues(assetMovement, (movements) => lodash
        .sumBy(movements, (m: any) =>
            (m.direction === 'in' ? parseFloat(m.volume) : -parseFloat(m.volume))
        ));
};

const calculateLabelByAssetClass = (movements: Movement[]) => {
    const assetsByVolume = groupMovementsByVolume(movements);
    return lodash
        .mapValues(assetsByVolume, (volume) =>
            (volume !== 0 ? Label.REVENUE : Label.IGNORE)
        );
};

const main = async () => {

    console.log('Starting script')

    const movements = await getAllMovementsFromTransactionHash(HASH);

    console.log('Movements fetched', movements);

    const labelByAssetClass = calculateLabelByAssetClass(movements);

    console.log('Label by asset class', labelByAssetClass);

    const movementsByLabel: { [key: string]: string[] } = {
        [Label.REVENUE]: [],
        [Label.IGNORE]: [],
    };

    lodash.forEach(labelByAssetClass, (label, asset) => {
        const movementIds = movements
            .filter((movement: any) => movement.asset === asset)
            .map((movement: any) => movement.id);
        movementsByLabel[label].push(...movementIds);
    });

    console.log('Updating labels');

    for (const label in movementsByLabel) {
        await updateMovementLabel(movementsByLabel[label], label);
    }
    console.log('IGNORE', movementsByLabel[Label.IGNORE]);
    console.log('REVENUE', movementsByLabel[Label.REVENUE]);

}

main().then(() => { console.log ('DONE')});