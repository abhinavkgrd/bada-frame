import PQueue from 'p-queue';
import { EnteFile } from 'types/file';
import {
    Face,
    FaceAlignmentMethod,
    FaceAlignmentService,
    FaceCropMethod,
    FaceCropService,
    FaceDetectionMethod,
    FaceDetectionService,
    FaceEmbeddingMethod,
    FaceEmbeddingService,
    MLSyncConfig,
    MLSyncContext,
    ClusteringMethod,
    ClusteringService,
    MLLibraryData,
} from 'types/machineLearning';
import { CONCURRENCY } from 'utils/common/concurrency';
import { getDedicatedCryptoWorker } from 'utils/crypto';
import { logQueueStats } from 'utils/machineLearning';
import arcfaceAlignmentService from './arcfaceAlignmentService';
import arcfaceCropService from './arcfaceCropService';
import hdbscanClusteringService from './hdbscanClusteringService';
import blazeFaceDetectionService from './blazeFaceDetectionService';
import mobileFaceNetEmbeddingService from './mobileFaceNetEmbeddingService';
import dbscanClusteringService from './dbscanClusteringService';
import { ComlinkWorker } from 'utils/comlink';

export class MLFactory {
    public static getFaceDetectionService(
        method: FaceDetectionMethod
    ): FaceDetectionService {
        if (method === 'BlazeFace') {
            return blazeFaceDetectionService;
        }

        throw Error('Unknon face detection method: ' + method);
    }

    public static getFaceCropService(method: FaceCropMethod) {
        if (method === 'ArcFace') {
            return arcfaceCropService;
        }

        throw Error('Unknon face crop method: ' + method);
    }

    public static getFaceAlignmentService(
        method: FaceAlignmentMethod
    ): FaceAlignmentService {
        if (method === 'ArcFace') {
            return arcfaceAlignmentService;
        }

        throw Error('Unknon face alignment method: ' + method);
    }

    public static getFaceEmbeddingService(
        method: FaceEmbeddingMethod
    ): FaceEmbeddingService {
        if (method === 'MobileFaceNet') {
            return mobileFaceNetEmbeddingService;
        }

        throw Error('Unknon face embedding method: ' + method);
    }

    public static getClusteringService(
        method: ClusteringMethod
    ): ClusteringService {
        if (method === 'Hdbscan') {
            return hdbscanClusteringService;
        }
        if (method === 'Dbscan') {
            return dbscanClusteringService;
        }

        throw Error('Unknon clustering method: ' + method);
    }

    public static getMLSyncContext(
        token: string,
        config: MLSyncConfig,
        shouldUpdateMLVersion: boolean = true
    ) {
        return new LocalMLSyncContext(token, config, shouldUpdateMLVersion);
    }
}

export class LocalMLSyncContext implements MLSyncContext {
    public token: string;
    public config: MLSyncConfig;
    public shouldUpdateMLVersion: boolean;

    public faceDetectionService: FaceDetectionService;
    public faceCropService: FaceCropService;
    public faceAlignmentService: FaceAlignmentService;
    public faceEmbeddingService: FaceEmbeddingService;
    public faceClusteringService: ClusteringService;

    public localFilesMap: Map<number, EnteFile>;
    public outOfSyncFiles: EnteFile[];
    public nSyncedFiles: number;
    public nSyncedFaces: number;
    public allSyncedFacesMap?: Map<number, Array<Face>>;
    public tsne?: any;

    public error?: Error;

    public mlLibraryData: MLLibraryData;

    public syncQueue: PQueue;
    // TODO: wheather to limit concurrent downloads
    // private downloadQueue: PQueue;

    private concurrency: number;
    private enteComlinkWorkers: Array<ComlinkWorker>;
    private enteWorkers: Array<any>;

    constructor(
        token: string,
        config: MLSyncConfig,
        shouldUpdateMLVersion: boolean = true,
        concurrency?: number
    ) {
        this.token = token;
        this.config = config;
        this.shouldUpdateMLVersion = shouldUpdateMLVersion;

        this.faceDetectionService = MLFactory.getFaceDetectionService(
            this.config.faceDetection.method
        );
        this.faceCropService = MLFactory.getFaceCropService(
            this.config.faceCrop.method
        );
        this.faceAlignmentService = MLFactory.getFaceAlignmentService(
            this.config.faceAlignment.method
        );
        this.faceEmbeddingService = MLFactory.getFaceEmbeddingService(
            this.config.faceEmbedding.method
        );
        this.faceClusteringService = MLFactory.getClusteringService(
            this.config.faceClustering.method
        );

        this.outOfSyncFiles = [];
        this.nSyncedFiles = 0;
        this.nSyncedFaces = 0;

        this.concurrency = concurrency || CONCURRENCY;

        console.log('Using concurrency: ', this.concurrency);
        // timeout is added on downloads
        // timeout on queue will keep the operation open till worker is terminated
        this.syncQueue = new PQueue({ concurrency: this.concurrency });
        logQueueStats(this.syncQueue, 'sync');
        // this.downloadQueue = new PQueue({ concurrency: 1 });
        // logQueueStats(this.downloadQueue, 'download');

        this.enteComlinkWorkers = new Array(this.concurrency);
        this.enteWorkers = new Array(this.concurrency);
    }

    public async getEnteWorker(id: number): Promise<any> {
        const wid = id % this.enteWorkers.length;
        if (!this.enteWorkers[wid]) {
            this.enteComlinkWorkers[wid] = getDedicatedCryptoWorker();
            this.enteWorkers[wid] = new this.enteComlinkWorkers[wid].comlink();
        }

        return this.enteWorkers[wid];
    }

    public async dispose() {
        // await this.faceDetectionService.dispose();
        // await this.faceEmbeddingService.dispose();

        this.localFilesMap = undefined;
        await this.syncQueue.onIdle();
        this.syncQueue.removeAllListeners();
        for (const enteComlinkWorker of this.enteComlinkWorkers) {
            enteComlinkWorker?.worker.terminate();
        }
    }
}
