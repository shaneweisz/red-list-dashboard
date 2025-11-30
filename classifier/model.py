"""
Species classifier model training and evaluation.
"""

import numpy as np
import joblib
from pathlib import Path
from typing import Optional, Literal

from sklearn.neighbors import KNeighborsClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC
from sklearn.neural_network import MLPClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, accuracy_score


ModelType = Literal["knn", "rf", "svm", "mlp", "lr"]


class SpeciesClassifier:
    """
    A classifier for identifying species locations using Tessera embeddings.
    """

    MODELS = {
        "knn": lambda: KNeighborsClassifier(n_neighbors=5),
        "rf": lambda: RandomForestClassifier(n_estimators=100, random_state=42),
        "svm": lambda: Pipeline([
            ("scaler", StandardScaler()),
            ("svm", SVC(probability=True, random_state=42))
        ]),
        "mlp": lambda: Pipeline([
            ("scaler", StandardScaler()),
            ("mlp", MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=500, random_state=42))
        ]),
        "lr": lambda: Pipeline([
            ("scaler", StandardScaler()),
            ("lr", LogisticRegression(max_iter=1000, random_state=42))
        ]),
    }

    def __init__(self, model_type: ModelType = "rf"):
        """
        Initialize the classifier.

        Args:
            model_type: Type of model to use ("knn", "rf", "svm", "mlp", "lr")
        """
        if model_type not in self.MODELS:
            raise ValueError(f"Unknown model type: {model_type}. Choose from {list(self.MODELS.keys())}")

        self.model_type = model_type
        self.model = self.MODELS[model_type]()
        self.is_trained = False
        self.train_stats = {}

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        test_size: float = 0.2,
        cv_folds: int = 5,
        random_state: int = 42
    ) -> dict:
        """
        Train the classifier and evaluate performance.

        Args:
            X: Feature matrix of shape (n_samples, 128)
            y: Labels (1 for positive, 0 for negative)
            test_size: Fraction of data to use for testing
            cv_folds: Number of cross-validation folds
            random_state: Random seed

        Returns:
            Dictionary with training statistics
        """
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=random_state, stratify=y
        )

        # Cross-validation
        cv_scores = cross_val_score(self.model, X_train, y_train, cv=cv_folds)

        # Train on full training set
        self.model.fit(X_train, y_train)
        self.is_trained = True

        # Evaluate
        y_pred = self.model.predict(X_test)
        test_accuracy = accuracy_score(y_test, y_pred)

        self.train_stats = {
            "model_type": self.model_type,
            "n_train": len(X_train),
            "n_test": len(X_test),
            "n_positive_train": int(y_train.sum()),
            "n_negative_train": int(len(y_train) - y_train.sum()),
            "cv_accuracy_mean": float(cv_scores.mean()),
            "cv_accuracy_std": float(cv_scores.std()),
            "test_accuracy": float(test_accuracy),
            "classification_report": classification_report(y_test, y_pred, target_names=["Background", "Species"], output_dict=True)
        }

        return self.train_stats

    def predict(self, X: np.ndarray) -> np.ndarray:
        """
        Predict class labels.

        Args:
            X: Feature matrix

        Returns:
            Array of predictions (0 or 1)
        """
        if not self.is_trained:
            raise RuntimeError("Model has not been trained yet")
        return self.model.predict(X)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """
        Predict class probabilities.

        Args:
            X: Feature matrix

        Returns:
            Array of probabilities for the positive class
        """
        if not self.is_trained:
            raise RuntimeError("Model has not been trained yet")
        return self.model.predict_proba(X)[:, 1]

    def save(self, path: str | Path) -> None:
        """Save the trained model to disk."""
        if not self.is_trained:
            raise RuntimeError("Model has not been trained yet")

        save_data = {
            "model": self.model,
            "model_type": self.model_type,
            "train_stats": self.train_stats,
        }
        joblib.dump(save_data, path)

    @classmethod
    def load(cls, path: str | Path) -> "SpeciesClassifier":
        """Load a trained model from disk."""
        data = joblib.load(path)

        classifier = cls(model_type=data["model_type"])
        classifier.model = data["model"]
        classifier.train_stats = data["train_stats"]
        classifier.is_trained = True

        return classifier


def compare_models(
    X: np.ndarray,
    y: np.ndarray,
    model_types: Optional[list[ModelType]] = None,
    test_size: float = 0.2,
    cv_folds: int = 5,
    random_state: int = 42
) -> dict[str, dict]:
    """
    Compare multiple classifier types on the same data.

    Args:
        X: Feature matrix
        y: Labels
        model_types: List of model types to compare (default: all)
        test_size: Fraction for test set
        cv_folds: Number of CV folds
        random_state: Random seed

    Returns:
        Dictionary mapping model type to training stats
    """
    if model_types is None:
        model_types = list(SpeciesClassifier.MODELS.keys())

    results = {}
    for model_type in model_types:
        print(f"\nTraining {model_type}...")
        clf = SpeciesClassifier(model_type=model_type)
        stats = clf.train(X, y, test_size=test_size, cv_folds=cv_folds, random_state=random_state)
        results[model_type] = {
            "classifier": clf,
            "stats": stats
        }
        print(f"  CV Accuracy: {stats['cv_accuracy_mean']:.3f} (+/- {stats['cv_accuracy_std']*2:.3f})")
        print(f"  Test Accuracy: {stats['test_accuracy']:.3f}")

    return results
